package com.qybaihe.botark.service

import android.os.Build
import com.qybaihe.botark.model.DirectHermesCredential
import com.qybaihe.botark.model.MobileWsEnvelope
import com.qybaihe.botark.model.PairApiResponse
import com.qybaihe.botark.model.PairedDesktopInfo
import com.qybaihe.botark.model.PairingPayload
import com.qybaihe.botark.model.PlatformId
import com.qybaihe.botark.model.WorkspaceSnapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import java.net.URLEncoder

class DesktopBridgeException(message: String, val unauthorized: Boolean = false) : Exception(message)

@Serializable
private data class PairRequestBody(
    val pairToken: String,
    val deviceName: String,
    val deviceModel: String
)

@Serializable
private data class SendMessageBody(
    val botId: String,
    val text: String,
    val clientMessageId: String
)

@Serializable
private data class BotActionBody(val botId: String)

@Serializable
private data class ApprovalDecisionBody(
    val accountId: String,
    val platformId: String,
    val approvalId: String,
    val decision: String
)

class DesktopBridgeClient {
    private val json = Json { ignoreUnknownKeys = true }
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    private val probeClient = OkHttpClient.Builder()
        .connectTimeout(2500, TimeUnit.MILLISECONDS)
        .readTimeout(2500, TimeUnit.MILLISECONDS)
        .build()

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var activeSocket: WebSocket? = null

    /**
     * Probes all LAN / Hotspot / Tailscale IPs in parallel and returns the first healthy host.
     */
    suspend fun probeBestHost(hosts: List<String>, port: Int): String? = coroutineScope {
        val candidates = hosts.distinct()
        val deferred = candidates.map { host ->
            async(Dispatchers.IO) {
                val req = Request.Builder()
                    .url("http://$host:$port/api/mobile/v1/ping")
                    .get()
                    .build()
                runCatching {
                    probeClient.newCall(req).execute().use { resp ->
                        if (!resp.isSuccessful) return@use null
                        val body = resp.body?.string().orEmpty()
                        val obj = json.decodeFromString<JsonObject>(body)
                        if (obj["ok"]?.jsonPrimitive?.booleanOrNull == true) host else null
                    }
                }.getOrNull()
            }
        }
        deferred.awaitAll().firstOrNull { it != null }
    }

    suspend fun pair(
        payload: PairingPayload
    ): Triple<PairedDesktopInfo, WorkspaceSnapshot, List<DirectHermesCredential>> = withContext(Dispatchers.IO) {
        val activeHost = probeBestHost(payload.hosts, payload.port)
            ?: throw DesktopBridgeException(
                "无法连接电脑端（${payload.hosts.joinToString(", ")}），请确认在同一 Wi-Fi / Tailscale 下"
            )

        val deviceName = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}".trim()
        val bodyJson = json.encodeToString(
            PairRequestBody(
                pairToken = payload.token,
                deviceName = deviceName.ifBlank { "Android" },
                deviceModel = "Android ${Build.VERSION.RELEASE}"
            )
        )

        val req = Request.Builder()
            .url("http://$activeHost:${payload.port}/api/mobile/v1/pair")
            .post(bodyJson.toRequestBody(jsonMedia))
            .build()

        val respBody = client.newCall(req).execute().use { resp ->
            val raw = resp.body?.string().orEmpty()
            val parsed = runCatching { json.decodeFromString<PairApiResponse>(raw) }.getOrNull()
                ?: throw DesktopBridgeException("电脑端返回数据无效（HTTP ${resp.code}）")
            if (!resp.isSuccessful || !parsed.ok || parsed.deviceId.isNullOrBlank() || parsed.deviceToken.isNullOrBlank()) {
                throw DesktopBridgeException(parsed.message ?: "配对失败（HTTP ${resp.code}）")
            }
            parsed
        }

        val directCreds = respBody.directCredentialsEnc?.takeIf { it.isNotBlank() }?.let { enc ->
            runCatching {
                val plain = SyncCrypto.decryptAesGcmCombined(enc, payload.key).toString(Charsets.UTF_8)
                json.decodeFromString<List<DirectHermesCredential>>(plain)
            }.getOrDefault(emptyList())
        } ?: emptyList()

        val info = PairedDesktopInfo(
            deviceId = respBody.deviceId!!,
            deviceToken = respBody.deviceToken!!,
            hostName = respBody.hostName ?: payload.name,
            activeHost = activeHost,
            candidateHosts = payload.hosts,
            port = payload.port,
            fingerprint = respBody.fp ?: payload.fp,
            pairedAtMs = System.currentTimeMillis().toDouble()
        )
        Triple(info, respBody.snapshot ?: WorkspaceSnapshot.EMPTY, directCreds)
    }

    suspend fun fetchSnapshot(desktop: PairedDesktopInfo): WorkspaceSnapshot = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("http://${desktop.activeHost}:${desktop.port}/api/mobile/v1/snapshot")
            .header("Authorization", "Bearer ${desktop.deviceToken}")
            .get()
            .build()

        client.newCall(req).execute().use { resp ->
            if (resp.code == 401) throw DesktopBridgeException("设备授权已失效，请重新扫码", unauthorized = true)
            if (!resp.isSuccessful) throw DesktopBridgeException("同步失败（HTTP ${resp.code}）")
            val raw = resp.body?.string().orEmpty()
            @Serializable
            data class SnapResp(val ok: Boolean = false, val snapshot: WorkspaceSnapshot? = null)
            val parsed = json.decodeFromString<SnapResp>(raw)
            parsed.snapshot ?: WorkspaceSnapshot.EMPTY
        }
    }

    suspend fun sendMessage(
        desktop: PairedDesktopInfo,
        botId: String,
        text: String,
        clientMessageId: String
    ) = withContext(Dispatchers.IO) {
        val body = json.encodeToString(SendMessageBody(botId, text, clientMessageId))
        val req = Request.Builder()
            .url("http://${desktop.activeHost}:${desktop.port}/api/mobile/v1/bots/${URLEncoder.encode(botId, "UTF-8")}/send")
            .header("Authorization", "Bearer ${desktop.deviceToken}")
            .post(body.toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { resp ->
            if (resp.code == 401) throw DesktopBridgeException("授权已失效", unauthorized = true)
            if (!resp.isSuccessful) throw DesktopBridgeException("发送失败（HTTP ${resp.code}）")
        }
    }

    suspend fun stopGeneration(desktop: PairedDesktopInfo, botId: String) = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("http://${desktop.activeHost}:${desktop.port}/api/mobile/v1/bots/${URLEncoder.encode(botId, "UTF-8")}/stop")
            .header("Authorization", "Bearer ${desktop.deviceToken}")
            .post(json.encodeToString(BotActionBody(botId)).toRequestBody(jsonMedia))
            .build()
        runCatching { client.newCall(req).execute().close() }
    }

    suspend fun startNewSession(desktop: PairedDesktopInfo, botId: String) = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("http://${desktop.activeHost}:${desktop.port}/api/mobile/v1/bots/${URLEncoder.encode(botId, "UTF-8")}/new-session")
            .header("Authorization", "Bearer ${desktop.deviceToken}")
            .post(json.encodeToString(BotActionBody(botId)).toRequestBody(jsonMedia))
            .build()
        runCatching { client.newCall(req).execute().close() }
    }

    suspend fun decideApproval(
        desktop: PairedDesktopInfo,
        accountId: String,
        platformId: PlatformId,
        approvalId: String,
        decision: String
    ) = withContext(Dispatchers.IO) {
        val body = json.encodeToString(
            ApprovalDecisionBody(accountId, platformId.wireId, approvalId, decision)
        )
        val req = Request.Builder()
            .url("http://${desktop.activeHost}:${desktop.port}/api/mobile/v1/approvals/${URLEncoder.encode(accountId, "UTF-8")}/${URLEncoder.encode(approvalId, "UTF-8")}")
            .header("Authorization", "Bearer ${desktop.deviceToken}")
            .post(body.toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw DesktopBridgeException("审批提交失败（HTTP ${resp.code}）")
        }
    }

    fun connectWebSocket(
        desktop: PairedDesktopInfo,
        onEvent: (MobileWsEnvelope) -> Unit,
        onDisconnect: () -> Unit
    ) {
        disconnectWebSocket()
        val req = Request.Builder()
            .url("ws://${desktop.activeHost}:${desktop.port}/api/mobile/v1/ws?token=${desktop.deviceToken}")
            .build()
        activeSocket = client.newWebSocket(req, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching { json.decodeFromString<MobileWsEnvelope>(text) }
                    .onSuccess(onEvent)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (activeSocket === webSocket) {
                    activeSocket = null
                    onDisconnect()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (activeSocket === webSocket) {
                    activeSocket = null
                    onDisconnect()
                }
            }
        })
    }

    fun disconnectWebSocket() {
        activeSocket?.close(1000, "client_disconnect")
        activeSocket = null
    }
}
