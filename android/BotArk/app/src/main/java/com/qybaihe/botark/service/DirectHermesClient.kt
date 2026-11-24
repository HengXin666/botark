package com.qybaihe.botark.service

import com.qybaihe.botark.model.DirectHermesCredential
import com.qybaihe.botark.model.SyncedApproval
import com.qybaihe.botark.model.SyncedToolCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

data class ParsedHermesSseEvent(val event: String, val data: String)

class HermesSseParser {
    private var currentEvent = ""
    private val currentData = mutableListOf<String>()

    fun feedLine(rawLine: String): ParsedHermesSseEvent? {
        val line = if (rawLine.endsWith("\r")) rawLine.dropLast(1) else rawLine
        if (line.isEmpty()) {
            val res = if (currentData.isEmpty()) null else ParsedHermesSseEvent(
                event = currentEvent.ifEmpty { "message" },
                data = currentData.joinToString("\n")
            )
            currentEvent = ""
            currentData.clear()
            return res
        }
        if (line.startsWith(":")) return null
        when {
            line.startsWith("event:") -> currentEvent = line.removePrefix("event:").trim()
            line.startsWith("data:") -> {
                val value = line.removePrefix("data:")
                currentData.add(if (value.startsWith(" ")) value.drop(1) else value)
            }
        }
        return null
    }
}

data class DirectHermesStreamResult(
    val messageId: String,
    val sessionId: String?,
    val finalText: String,
    val tools: List<SyncedToolCall>
)

/**
 * Standalone zero-server Hermes client for Android.
 * Automatically activates when BotArk Desktop is asleep/offline.
 */
class DirectHermesClient {
    private val json = Json { ignoreUnknownKeys = true }
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()
    private val activeRunIds = ConcurrentHashMap<String, String>()

    private val baseClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .build()

    private fun client(): OkHttpClient {
        if (!MihomoManager.isRunning()) return baseClient
        return baseClient.newBuilder()
            .proxy(Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", MihomoManager.MIXED_PORT)))
            .build()
    }

    companion object {
        fun normalizeBaseUrl(raw: String): String {
            var s = raw.trim()
            if (!s.contains("://")) s = "http://$s"
            while (s.endsWith("/")) s = s.dropLast(1)
            val lower = s.lowercase()
            s = when {
                lower.endsWith("/v1/chat/completions") -> s.dropLast("/v1/chat/completions".length)
                lower.endsWith("/v1") -> s.dropLast(3)
                else -> s
            }
            while (s.endsWith("/")) s = s.dropLast(1)
            return s
        }
    }

    suspend fun probe(baseUrl: String, apiKey: String?): Pair<String?, String> = withContext(Dispatchers.IO) {
        val base = normalizeBaseUrl(baseUrl)
        var version: String? = null
        runCatching {
            val healthReq = Request.Builder().url("$base/health").get().build()
            client().newCall(healthReq).execute().use { resp ->
                if (resp.isSuccessful) {
                    val obj = json.decodeFromString<JsonObject>(resp.body?.string().orEmpty())
                    version = obj["version"]?.jsonPrimitive?.contentOrNull
                }
            }
        }
        val modelsReq = Request.Builder().url("$base/v1/models").apply {
            apiKey?.trim()?.takeIf { it.isNotEmpty() }?.let { header("Authorization", "Bearer $it") }
        }.get().build()

        client().newCall(modelsReq).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw Exception(if (resp.code == 401) "API Key 无效" else "Hermes 连接失败（HTTP ${resp.code}）")
            }
            val raw = resp.body?.string().orEmpty()
            val model = runCatching {
                val obj = json.decodeFromString<JsonObject>(raw)
                val arr: JsonArray = obj["data"]?.jsonArray ?: return@runCatching "hermes-agent"
                arr.firstOrNull()?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull
                    ?.takeIf { it.isNotEmpty() } ?: "hermes-agent"
            }.getOrDefault("hermes-agent")
            version to model
        }
    }

    private fun createSession(base: String, apiKey: String?, title: String, model: String?): Pair<Int, String?> {
        val body = buildJsonObject {
            put("source", "api_server")
            put("title", title.take(60))
            if (!model.isNullOrBlank() && model != "hermes-agent") put("model", model)
        }.toString()
        val req = Request.Builder()
            .url("$base/api/sessions")
            .apply { apiKey?.takeIf { it.isNotBlank() }?.let { header("Authorization", "Bearer $it") } }
            .post(body.toRequestBody(jsonMedia))
            .build()
        return client().newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return@use resp.code to null
            val obj = runCatching { json.decodeFromString<JsonObject>(resp.body?.string().orEmpty()) }.getOrNull()
            val id = obj?.get("session")?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull
                ?: obj?.get("id")?.jsonPrimitive?.contentOrNull
            resp.code to id
        }
    }

    suspend fun streamChat(
        credential: DirectHermesCredential,
        botId: String,
        sessionId: String?,
        text: String,
        onDelta: (messageId: String, partialText: String, tools: List<SyncedToolCall>, sessionId: String?) -> Unit,
        onApproval: (List<SyncedApproval>) -> Unit
    ): DirectHermesStreamResult = withContext(Dispatchers.IO) {
        val base = normalizeBaseUrl(credential.baseUrl)
        var sid = sessionId?.takeIf { it.isNotBlank() }
        var fallback = false

        if (sid == null) {
            val (code, created) = createSession(base, credential.apiKey, text, credential.model)
            if (code == 404 || code == 405 || code == 501) {
                fallback = true
            } else if (created != null) {
                sid = created
            }
        }

        if (!fallback && sid != null) {
            val nativeRes = runCatching {
                streamNativeSession(base, credential, botId, sid, text, onDelta, onApproval)
            }
            if (nativeRes.isSuccess) return@withContext nativeRes.getOrThrow()
        }

        streamOpenAIFallback(base, credential, botId, sid, text, onDelta)
    }

    private fun streamNativeSession(
        base: String,
        credential: DirectHermesCredential,
        botId: String,
        sessionId: String,
        text: String,
        onDelta: (String, String, List<SyncedToolCall>, String?) -> Unit,
        onApproval: (List<SyncedApproval>) -> Unit
    ): DirectHermesStreamResult {
        val encoded = URLEncoder.encode(sessionId, "UTF-8").replace("+", "%20")
        val body = buildJsonObject {
            put("message", text)
            credential.model?.takeIf { it.isNotBlank() }?.let { put("model", it) }
        }.toString()
        val req = Request.Builder()
            .url("$base/api/sessions/$encoded/chat/stream")
            .header("Accept", "text/event-stream")
            .header("X-Hermes-Session-Key", "botark-android:$botId")
            .apply { credential.apiKey?.takeIf { it.isNotBlank() }?.let { header("Authorization", "Bearer $it") } }
            .post(body.toRequestBody(jsonMedia))
            .build()

        client().newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw Exception("Hermes HTTP ${resp.code}")
            val reader = BufferedReader(InputStreamReader(resp.body!!.byteStream()))
            val parser = HermesSseParser()
            var messageId = "hermes_${System.currentTimeMillis()}"
            var effectiveSid = resp.header("X-Hermes-Session-Id") ?: sessionId
            val accumulated = StringBuilder()
            var completed = ""
            val tools = mutableListOf<SyncedToolCall>()

            while (true) {
                val line = reader.readLine() ?: break
                val frame = parser.feedLine(line) ?: continue
                if (frame.data == "[DONE]") break
                val obj = runCatching { json.decodeFromString<JsonObject>(frame.data) }.getOrNull() ?: continue
                obj["run_id"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() }?.let {
                    activeRunIds[credential.accountId] = it
                }
                obj["session_id"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() }?.let {
                    effectiveSid = it
                }
                when (frame.event) {
                    "message.started" -> {
                        obj["message"]?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull?.let {
                            messageId = "hermes_$it"
                        }
                    }
                    "assistant.delta" -> {
                        obj["message_id"]?.jsonPrimitive?.contentOrNull?.let { messageId = "hermes_$it" }
                        val delta = obj["delta"]?.jsonPrimitive?.contentOrNull.orEmpty()
                        if (delta.isNotEmpty()) {
                            accumulated.append(delta)
                            onDelta(messageId, accumulated.toString(), tools.toList(), effectiveSid)
                        }
                    }
                    "tool.started" -> {
                        val name = obj["tool_name"]?.jsonPrimitive?.contentOrNull ?: "tool"
                        val preview = obj["preview"]?.jsonPrimitive?.contentOrNull
                        tools.add(SyncedToolCall("t_${tools.size + 1}", name, status = "running", summary = preview))
                        onDelta(messageId, accumulated.toString(), tools.toList(), effectiveSid)
                    }
                    "tool.completed", "tool.failed" -> {
                        val name = obj["tool_name"]?.jsonPrimitive?.contentOrNull ?: "tool"
                        val preview = obj["preview"]?.jsonPrimitive?.contentOrNull
                        val status = if (frame.event == "tool.failed") "errored" else "completed"
                        val idx = tools.indexOfLast { it.name == name && it.status == "running" }
                        if (idx >= 0) {
                            tools[idx] = tools[idx].copy(status = status, summary = preview ?: tools[idx].summary)
                        } else {
                            tools.add(SyncedToolCall("t_${tools.size + 1}", name, status = status, summary = preview))
                        }
                        onDelta(messageId, accumulated.toString(), tools.toList(), effectiveSid)
                    }
                    "approval.request" -> {
                        val reqId = obj["request_id"]?.jsonPrimitive?.contentOrNull ?: "apr_${System.currentTimeMillis()}"
                        val cmd = obj["command"]?.jsonPrimitive?.contentOrNull.orEmpty()
                        val desc = obj["description"]?.jsonPrimitive?.contentOrNull.orEmpty()
                        onApproval(
                            listOf(
                                SyncedApproval(
                                    id = reqId,
                                    status = "pending",
                                    title = if (cmd.isNotEmpty()) "允许执行：$cmd" else desc.ifEmpty { "Hermes 审批" },
                                    detail = desc.ifEmpty { cmd },
                                    approvalType = "hermes_command"
                                )
                            )
                        )
                    }
                    "assistant.completed" -> {
                        obj["content"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() }?.let {
                            completed = it
                        }
                    }
                    "error" -> {
                        throw Exception(obj["message"]?.jsonPrimitive?.contentOrNull ?: "Hermes 运行出错")
                    }
                }
            }
            onApproval(emptyList())
            return DirectHermesStreamResult(
                messageId = messageId,
                sessionId = effectiveSid,
                finalText = completed.ifEmpty { accumulated.toString() },
                tools = tools.toList()
            )
        }
    }

    private fun streamOpenAIFallback(
        base: String,
        credential: DirectHermesCredential,
        botId: String,
        sessionId: String?,
        text: String,
        onDelta: (String, String, List<SyncedToolCall>, String?) -> Unit
    ): DirectHermesStreamResult {
        val body = buildJsonObject {
            put("model", credential.model ?: "hermes-agent")
            put("stream", true)
            put("messages", buildJsonArray {
                add(buildJsonObject {
                    put("role", "user")
                    put("content", text)
                })
            })
        }.toString()
        val req = Request.Builder()
            .url("$base/v1/chat/completions")
            .header("Accept", "text/event-stream")
            .header("X-Hermes-Session-Key", "botark-android:$botId")
            .apply {
                sessionId?.let { header("X-Hermes-Session-Id", it) }
                credential.apiKey?.takeIf { it.isNotBlank() }?.let { header("Authorization", "Bearer $it") }
            }
            .post(body.toRequestBody(jsonMedia))
            .build()

        client().newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw Exception("Hermes HTTP ${resp.code}")
            val reader = BufferedReader(InputStreamReader(resp.body!!.byteStream()))
            val parser = HermesSseParser()
            var messageId = "hermes_${System.currentTimeMillis()}"
            val effectiveSid = resp.header("X-Hermes-Session-Id") ?: sessionId
            val accumulated = StringBuilder()

            while (true) {
                val line = reader.readLine() ?: break
                val frame = parser.feedLine(line) ?: continue
                if (frame.data == "[DONE]") break
                val obj = runCatching { json.decodeFromString<JsonObject>(frame.data) }.getOrNull() ?: continue
                obj["id"]?.jsonPrimitive?.contentOrNull?.let { messageId = "hermes_$it" }
                val piece = obj["choices"]?.jsonArray?.firstOrNull()?.jsonObject
                    ?.get("delta")?.jsonObject?.get("content")?.jsonPrimitive?.contentOrNull.orEmpty()
                if (piece.isNotEmpty()) {
                    accumulated.append(piece)
                    onDelta(messageId, accumulated.toString(), emptyList(), effectiveSid)
                }
            }
            return DirectHermesStreamResult(messageId, effectiveSid, accumulated.toString(), emptyList())
        }
    }

    suspend fun decideApproval(
        credential: DirectHermesCredential,
        approvalId: String,
        decision: String
    ) = withContext(Dispatchers.IO) {
        val runId = activeRunIds[credential.accountId] ?: return@withContext
        val base = normalizeBaseUrl(credential.baseUrl)
        val choice = when (decision) {
            "allow_once", "allow-once" -> "once"
            "allow_session", "allow-session" -> "session"
            "allow_always", "allow-always" -> "always"
            else -> "deny"
        }
        val body = buildJsonObject {
            put("choice", choice)
            put("request_id", approvalId)
        }.toString()
        val req = Request.Builder()
            .url("$base/v1/runs/$runId/approval")
            .apply { credential.apiKey?.takeIf { it.isNotBlank() }?.let { header("Authorization", "Bearer $it") } }
            .post(body.toRequestBody(jsonMedia))
            .build()
        runCatching { client().newCall(req).execute().close() }
    }
}
