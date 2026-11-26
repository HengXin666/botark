package com.qybaihe.botark.service

import com.qybaihe.botark.model.HarkCredential
import com.qybaihe.botark.model.SyncedHarkProject
import com.qybaihe.botark.model.SyncedMediaPart
import com.qybaihe.botark.model.SyncedMessage
import com.qybaihe.botark.model.SyncedToolCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.URLEncoder
import java.time.Instant
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.TimeUnit

class HarkDirectException(message: String, val status: Int = 0) : Exception(message)

data class HarkSendResult(
    val conversationId: String,
    val responseMessageId: String,
    val idempotencyKey: String
)

/**
 * Native Android Hark client.
 *
 * It talks to app.hark.com with the better-auth cookies exported during QR
 * pairing. No desktop bridge is involved after pairing. All HTTP calls use the
 * bundled mihomo local mixed-port when the in-app proxy is running, so the
 * phone reproduces the desktop account proxy path as closely as possible.
 */
class HarkDirectClient {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()
    private var cachedClient: OkHttpClient? = null
    private var cachedProxyState: Boolean? = null

    companion object {
        private const val BASE = "https://app.hark.com/api"
        private const val ORIGIN = "https://app.hark.com"
        private const val MAX_ARTIFACT_BYTES = 24L * 1024L * 1024L
        private const val USER_AGENT =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Hark/0.1.21 Chrome/134.0.6998.88 Safari/537.36"
    }

    private fun httpClient(): OkHttpClient {
        val proxyRunning = MihomoManager.isRunning()
        val old = cachedClient
        if (old != null && cachedProxyState == proxyRunning) return old
        val builder = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(75, TimeUnit.SECONDS)
            .writeTimeout(45, TimeUnit.SECONDS)
        if (proxyRunning) {
            builder.proxy(Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", MihomoManager.MIXED_PORT)))
        }
        return builder.build().also {
            cachedClient = it
            cachedProxyState = proxyRunning
        }
    }

    private fun headers(cred: HarkCredential): Map<String, String> = mapOf(
        "Accept" to "application/json",
        "Accept-Language" to "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "Origin" to ORIGIN,
        "Referer" to "$ORIGIN/",
        "User-Agent" to USER_AGENT,
        "X-Hark-Locale" to (Locale.getDefault().toLanguageTag().ifBlank { "zh-CN" }),
        "X-Hark-Timezone" to (cred.timezone.ifBlank {
            TimeZone.getDefault().id.ifBlank { "UTC" }
        }),
        "X-Hark-Client-Version" to "0.1.21",
        "Cookie" to cred.cookie.replace("\r", "").replace("\n", "")
    )

    private fun request(
        cred: HarkCredential,
        method: String,
        path: String,
        query: Map<String, String> = emptyMap(),
        body: JsonElement? = null
    ): JsonElement? {
        val baseUrl = (BASE + path).toHttpUrl().newBuilder()
        query.forEach { (key, value) -> if (value.isNotBlank()) baseUrl.addQueryParameter(key, value) }
        val req = Request.Builder()
            .url(baseUrl.build())
            .apply {
                headers(cred).forEach { (key, value) -> header(key, value) }
                if (body != null) header("Content-Type", "application/json")
            }
            .method(method, if (body == null) null else body.toString().toRequestBody(jsonMedia))
            .build()
        return httpClient().newCall(req).execute().use { resp ->
            if (resp.code == 401 || resp.code == 403) {
                throw HarkDirectException("Hark 登录已失效，请重新扫码同步账号", resp.code)
            }
            if (!resp.isSuccessful) {
                val text = resp.body?.string().orEmpty()
                val message = runCatching {
                    json.parseToJsonElement(text).jsonObject["message"]?.jsonPrimitive?.contentOrNull
                }.getOrNull()
                throw HarkDirectException(message ?: "Hark 请求失败（HTTP ${resp.code}）", resp.code)
            }
            val text = resp.body?.string().orEmpty().trim()
            if (text.isEmpty()) null else json.parseToJsonElement(text)
        }
    }

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }

    private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject
    private fun JsonObject.array(key: String): JsonArray? = this[key] as? JsonArray

    private fun parseProject(raw: JsonObject): SyncedHarkProject? {
        val id = raw.string("id") ?: raw.string("conversationId") ?: return null
        val kind = if (raw.string("kind") == "main") "main" else "project"
        return SyncedHarkProject(
            id = id,
            kind = kind,
            title = raw.string("title"),
            favorite = (raw["favorite"] as? JsonPrimitive)?.contentOrNull == "true",
            archivedAt = raw.string("archivedAt"),
            createdAt = raw.string("createdAt"),
            activityAt = raw.string("activityAt")
                ?: raw.string("updatedAt")
                ?: raw.string("createdAt")
                ?: ""
        )
    }

    suspend fun authStatus(cred: HarkCredential): Boolean = withContext(Dispatchers.IO) {
        try {
            val data = request(cred, "GET", "/auth/get-session")
            if (data == null || data is JsonNull) false
            else {
                val root = data as? JsonObject
                root?.get("user") != null || root?.get("session") != null
            }
        } catch (_: Exception) {
            false
        }
    }

    suspend fun listProjects(cred: HarkCredential): List<SyncedHarkProject> = withContext(Dispatchers.IO) {
        val root = request(cred, "GET", "/conversations") as? JsonObject ?: return@withContext emptyList()
        (root.array("conversations") ?: JsonArray(emptyList()))
            .mapNotNull { (it as? JsonObject)?.let(::parseProject) }
    }

    suspend fun listStatuses(cred: HarkCredential): Map<String, String> = withContext(Dispatchers.IO) {
        val root = request(cred, "GET", "/conversations/status") as? JsonObject ?: return@withContext emptyMap()
        val statuses = root.obj("statuses") ?: return@withContext emptyMap()
        buildMap {
            statuses.forEach { (id, value) ->
                val text = (value as? JsonPrimitive)?.contentOrNull.orEmpty()
                if (text.isNotBlank()) put(id, text)
            }
        }
    }

    suspend fun mainConversationId(cred: HarkCredential): String? = withContext(Dispatchers.IO) {
        val root = request(
            cred, "GET", "/conversations/main",
            query = mapOf("timezone" to (cred.timezone.ifBlank { TimeZone.getDefault().id }))
        ) as? JsonObject
        root?.string("conversationId")
            ?: root?.string("id")
            ?: root?.obj("conversation")?.string("id")
            ?: root?.obj("main")?.string("id")
            ?: listProjects(cred).firstOrNull { it.kind == "main" }?.id
            ?: listProjects(cred).firstOrNull()?.id
    }

    suspend fun fetchMessages(
        cred: HarkCredential,
        conversationId: String,
        botId: String,
        accountId: String
    ): List<SyncedMessage> = withContext(Dispatchers.IO) {
        val root = request(
            cred, "GET", "/sync/poll",
            query = mapOf(
                "conversationId" to conversationId,
                "v" to "2",
                "manager" to UUID.randomUUID().toString(),
                "mode" to "in_tab",
                "dial" to "initial",
                "first" to "1"
            )
        ) as? JsonObject ?: return@withContext emptyList()
        val state = HarkSyncState(json)
        (root.array("frames") ?: JsonArray(emptyList())).forEach { frame ->
            val text = (frame as? JsonPrimitive)?.contentOrNull ?: return@forEach
            state.applyFrame(text)
        }
        val out = mutableListOf<SyncedMessage>()
        for (raw in state.messages()) {
            rawToMessage(raw, botId, accountId)?.let { out.add(it) }
        }
        out
    }

    suspend fun sendMessage(
        cred: HarkCredential,
        conversationId: String,
        text: String
    ): HarkSendResult = withContext(Dispatchers.IO) {
        val idempotencyKey = UUID.randomUUID().toString()
        val responseMessageId = UUID.randomUUID().toString()
        request(
            cred, "POST", "/messages/send",
            query = mapOf("cid" to conversationId),
            body = buildJsonObject {
                put("timezone", cred.timezone.ifBlank { TimeZone.getDefault().id })
                put("conversationId", conversationId)
                put("message", text)
                put("idempotencyKey", idempotencyKey)
                put("responseMessageId", responseMessageId)
            }
        )
        HarkSendResult(conversationId, responseMessageId, idempotencyKey)
    }

    suspend fun awaitReply(
        cred: HarkCredential,
        conversationId: String,
        botId: String,
        accountId: String,
        afterIds: Set<String>,
        timeoutMs: Long = 600_000,
        onUpdate: (List<SyncedMessage>, Boolean) -> Unit
    ): List<SyncedMessage> = withContext(Dispatchers.IO) {
        val started = System.currentTimeMillis()
        var last: List<SyncedMessage> = emptyList()
        var lastReplyText = ""
        var stable = 0
        while (System.currentTimeMillis() - started < timeoutMs) {
            val statusResult = runCatching { listStatuses(cred) }
            val statusKnown = statusResult.isSuccess
            val statuses = statusResult.getOrDefault(emptyMap())
            val messages = runCatching { fetchMessages(cred, conversationId, botId, accountId) }
                .getOrDefault(last)
            last = messages
            val observedWorking = statuses[conversationId].equals("working", ignoreCase = true)
            val working = if (statusKnown) observedWorking else true
            val reply = messages.lastOrNull {
                !it.isUser && it.id !in afterIds && it.text.isNotBlank()
            }
            val replyText = reply?.text.orEmpty()
            if (reply != null && replyText == lastReplyText) {
                stable++
            } else if (reply != null && statusKnown && !observedWorking) {
                stable++
            } else {
                stable = 0
            }
            lastReplyText = replyText
            onUpdate(messages, working)
            val requiredStable = if (statusKnown) 2 else 10
            if (reply != null && stable >= requiredStable && (!statusKnown || !observedWorking)) {
                return@withContext messages
            }
            delay(2_000)
        }
        last
    }

    suspend fun billingSummary(cred: HarkCredential): JsonElement? = withContext(Dispatchers.IO) {
        request(cred, "GET", "/billing/summary")
    }

    suspend fun linkConnectorSession(
        cred: HarkCredential,
        provider: String,
        returnUrl: String,
        origin: String = "chat"
    ): JsonElement? = withContext(Dispatchers.IO) {
        request(
            cred, "POST", "/connectors/link-sessions",
            body = buildJsonObject {
                put("provider", provider)
                put("returnUrl", returnUrl)
                put("origin", origin)
            }
        )
    }

    suspend fun pauseAgent(cred: HarkCredential, conversationId: String) = withContext(Dispatchers.IO) {
        runCatching {
            request(
                cred, "POST", "/messages/pause-agent",
                body = buildJsonObject { put("conversationId", conversationId) }
            )
        }
        Unit
    }

    suspend fun markViewed(cred: HarkCredential, conversationId: String) = withContext(Dispatchers.IO) {
        runCatching {
            request(
                cred, "POST",
                "/conversations/${URLEncoder.encode(conversationId, "UTF-8")}/viewed"
            )
        }
        Unit
    }

    suspend fun deleteProject(cred: HarkCredential, conversationId: String) = withContext(Dispatchers.IO) {
        try {
            request(
                cred, "DELETE",
                "/conversations/${URLEncoder.encode(conversationId, "UTF-8")}"
            )
        } catch (e: HarkDirectException) {
            if (e.status != 404) throw e
        }
        Unit
    }

    suspend fun createProject(cred: HarkCredential, title: String): String? = withContext(Dispatchers.IO) {
        val root = request(
            cred, "POST", "/conversations",
            body = buildJsonObject {
                put("title", title.trim())
                put("timezone", cred.timezone.ifBlank { TimeZone.getDefault().id })
                put("autoTitle", title.isBlank())
            }
        ) as? JsonObject
        root?.string("conversationId") ?: root?.string("id")
    }

    suspend fun downloadArtifact(
        cred: HarkCredential,
        url: String? = null,
        fileId: String? = null,
        name: String? = null
    ): String? = withContext(Dispatchers.IO) {
        val reference = url?.takeIf { it.isNotBlank() }
            ?: fileId?.replace(Regex("^(harkatt|harkfile)://"), "")?.takeIf { it.isNotBlank() }
            ?: return@withContext null
        val target = when {
            reference.startsWith("http://") || reference.startsWith("https://") -> reference
            reference.startsWith("/") -> ORIGIN + reference
            else -> resolvePresignedUrl(cred, reference)
        } ?: return@withContext null
        try {
            val targetUrl = target.toHttpUrl()
            val isHarkHost = targetUrl.isHttps && targetUrl.host.equals("app.hark.com", ignoreCase = true)
            val req = Request.Builder()
                .url(targetUrl)
                .header("User-Agent", USER_AGENT)
                .apply { if (isHarkHost) header("Cookie", cred.cookie) }
                .get()
                .build()
            httpClient().newBuilder().followRedirects(false).build().newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext null
                val length = resp.body?.contentLength() ?: 0L
                if (length > MAX_ARTIFACT_BYTES) return@withContext null
                val bytes = resp.body?.bytes() ?: return@withContext null
                if (bytes.size > MAX_ARTIFACT_BYTES) return@withContext null
                val mime = resp.header("Content-Type")
                    ?.substringBefore(';')
                    ?.takeIf { it.contains('/') }
                    ?: inferMime(name ?: target)
                "data:${mime};base64,${android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)}"
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun resolvePresignedUrl(cred: HarkCredential, key: String): String? {
        for (endpoint in listOf("/images/presign", "/files/presign")) {
            try {
                val data = request(
                    cred, "POST", endpoint,
                    body = buildJsonObject { put("keys", buildJsonArray { add(JsonPrimitive(key)) }) }
                )
                findHttpUrl(data)?.let { return it }
            } catch (_: Exception) {
                /* try next */
            }
        }
        return try {
            findHttpUrl(
                request(
                    cred, "GET", "/files/download",
                    query = mapOf("key" to key)
                )
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun findHttpUrl(value: JsonElement?): String? {
        return when (value) {
            is JsonPrimitive -> value.contentOrNull?.takeIf {
                it.startsWith("http://") || it.startsWith("https://")
            }
            is JsonArray -> value.firstNotNullOfOrNull { findHttpUrl(it) }
            is JsonObject -> value.values.firstNotNullOfOrNull { findHttpUrl(it) }
            else -> null
        }
    }

    private fun inferMime(name: String?): String {
        val path = name.orEmpty().lowercase(Locale.ROOT)
        return when {
            path.endsWith(".png") -> "image/png"
            path.endsWith(".jpg") || path.endsWith(".jpeg") -> "image/jpeg"
            path.endsWith(".gif") -> "image/gif"
            path.endsWith(".webp") -> "image/webp"
            path.endsWith(".pdf") -> "application/pdf"
            path.endsWith(".json") -> "application/json"
            else -> "application/octet-stream"
        }
    }

    private data class HarkArtifactRef(
        val path: String?,
        val s3Key: String?,
        val downloadUrl: String?,
        val name: String,
        val mimeType: String
    )

    private fun presentationText(raw: JsonObject): String? {
        val pres = raw["presentation"] as? JsonObject ?: return null
        val kind = pres.string("kind")?.lowercase(Locale.ROOT).orEmpty()
        return when (kind) {
            "summary" -> {
                val summary = pres.obj("summary") ?: pres
                val title = summary.string("title")?.let { "### $it\n\n" }.orEmpty()
                val markdown = summary.string("markdown").orEmpty()
                (title + markdown).trim().ifBlank { null }
            }
            "document", "markdown", "article", "report" -> {
                val nested = (pres[kind] as? JsonObject)
                    ?: pres.obj("document") ?: pres.obj("markdown") ?: pres
                val title = nested.string("title")?.let { "# $it\n\n" }.orEmpty()
                val body = nested.string("markdown") ?: nested.string("content") ?: nested.string("body").orEmpty()
                (title + body).trim().ifBlank { null }
            }
            "code" -> {
                val code = pres.obj("code") ?: pres
                val lang = code.string("language").orEmpty()
                val source = code.string("source").orEmpty()
                if (source.isBlank()) null else "```$lang\n$source\n```"
            }
            "text_template" -> {
                val template = pres.obj("text_template") ?: pres
                val title = template.string("title")?.let { "**$it**\n\n" }.orEmpty()
                (title + template.string("body").orEmpty()).trim().ifBlank { null }
            }
            "links" -> {
                val links = pres["links"] as? JsonArray ?: return null
                links.mapNotNull { item ->
                    val link = item as? JsonObject ?: return@mapNotNull null
                    val url = link.string("url") ?: return@mapNotNull null
                    val label = link.string("title") ?: link.string("label") ?: url
                    "- [$label]($url)"
                }.joinToString("\n").ifBlank { null }
            }
            else -> null
        }
    }

    private fun artifactsFromRaw(raw: JsonObject): List<HarkArtifactRef> {
        val out = LinkedHashMap<String, HarkArtifactRef>()
        fun push(item: HarkArtifactRef?) {
            if (item == null) return
            val key = item.s3Key ?: item.downloadUrl ?: item.path ?: return
            out.putIfAbsent(key, item)
        }
        fun pushEntry(entry: JsonElement?, defaultMime: String? = null) {
            when (entry) {
                is JsonPrimitive -> {
                    val value = entry.contentOrNull?.trim().orEmpty()
                    if (value.isBlank()) return
                    val isHttp = value.startsWith("http://", ignoreCase = true) ||
                        value.startsWith("https://", ignoreCase = true)
                    val name = value.substringBefore('?').substringBefore('#')
                        .substringAfterLast('/').ifBlank { value }
                    push(
                        HarkArtifactRef(
                            path = value,
                            s3Key = if (isHttp) null else value,
                            downloadUrl = if (isHttp) value else null,
                            name = name,
                            mimeType = defaultMime ?: inferMime(name)
                        )
                    )
                }
                is JsonObject -> {
                    val s3 = entry.firstString(
                        "s3Key", "s3_key", "key", "imageKey", "image_key", "videoKey", "video_key"
                    )
                    val download = entry.firstString(
                        "downloadUrl", "download_url", "previewUrl", "preview_url", "imageUrl", "image_url",
                        "videoUrl", "video_url", "mediaUrl", "media_url"
                    ) ?: entry.firstString("url")?.takeIf {
                        it.startsWith("http://", ignoreCase = true) || it.startsWith("https://", ignoreCase = true)
                    }
                    val path = entry.firstString("path", "filePath", "file_path", "name") ?: download ?: s3
                    if (path == null && s3 == null && download == null) return
                    val name = entry.firstString("name", "filename", "title")
                        ?: path?.substringBefore('?')?.substringBefore('#')?.substringAfterLast('/')?.ifBlank { null }
                        ?: "artifact"
                    val mime = entry.firstString(
                        "mediaType", "media_type", "mimeType", "mime_type", "contentType", "content_type"
                    ) ?: defaultMime ?: inferMime(name)
                    push(
                        HarkArtifactRef(
                            path = path,
                            s3Key = s3,
                            downloadUrl = download,
                            name = name,
                            mimeType = mime
                        )
                    )
                }
                else -> Unit
            }
        }

        val listKeys = listOf(
            "artifactKeys" to null as String?,
            "artifact_keys" to null,
            "artifacts" to null,
            "attachments" to null,
            "files" to null,
            "media" to null,
            "imageStack" to "image/png",
            "image_stack" to "image/png",
            "images" to "image/png",
            "videos" to "video/mp4"
        )
        for ((key, defaultMime) in listKeys) {
            when (val value = raw[key]) {
                is JsonArray -> value.forEach { pushEntry(it, defaultMime) }
                is JsonObject -> {
                    val items = value["items"]
                    if (items is JsonArray) {
                        items.forEach { pushEntry(it, defaultMime) }
                    } else {
                        val images = value["images"]
                        if (images is JsonArray) images.forEach { pushEntry(it, "image/png") }
                        else pushEntry(value, defaultMime)
                    }
                }
                else -> Unit
            }
        }

        pushEntry(raw["screenshotUrl"], "image/png")
        pushEntry(raw["screenshotKey"], "image/png")
        pushEntry(raw["previewUrl"], "image/png")
        pushEntry(raw["imageUrl"], "image/png")
        (raw["agentActivityWindow"] as? JsonArray)?.forEach { item ->
            val window = item as? JsonObject ?: return@forEach
            pushEntry(window["screenshot"], "image/png")
            pushEntry(window["screenshotUrl"], "image/png")
        }

        val presentation = raw["presentation"] as? JsonObject
        if (presentation != null) {
            val kind = presentation.string("kind")?.lowercase(Locale.ROOT).orEmpty()
            val mediaKind = kind in setOf(
                "image", "images", "image_stack", "gallery", "video", "audio", "media", "file", "artifact"
            )
            val nested = presentation[kind] ?: if (mediaKind) presentation else null
            val defaultMime = when {
                kind.contains("image") || kind == "gallery" -> "image/png"
                kind == "video" -> "video/mp4"
                kind == "audio" -> "audio/mpeg"
                else -> null
            }
            when (nested) {
                is JsonArray -> nested.forEach { pushEntry(it, defaultMime) }
                is JsonObject -> {
                    for (sub in listOf("items", "images", "videos", "files", "media", "artifacts")) {
                        val array = nested[sub] as? JsonArray ?: continue
                        val mime = when (sub) {
                            "images" -> "image/png"
                            "videos" -> "video/mp4"
                            else -> defaultMime
                        }
                        array.forEach { pushEntry(it, mime) }
                    }
                    pushEntry(nested, defaultMime)
                }
                else -> Unit
            }
        }
        return out.values.toList()
    }

    private fun JsonObject.firstString(vararg keys: String): String? =
        keys.firstNotNullOfOrNull { key ->
            (this[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
        }

    private fun rawToMessage(
        raw: JsonObject,
        botId: String,
        accountId: String
    ): SyncedMessage? {
        val rawId = raw.string("id") ?: return null
        val role = raw.string("role") ?: raw.string("author") ?: "assistant"
        val isUser = role.equals("user", ignoreCase = true)
        val rawText = raw.string("content")
            ?: raw.string("text")
            ?: raw.string("message")
            ?: ""
        val text = if (rawText.isBlank()) presentationText(raw).orEmpty() else rawText

        val tools = raw.array("toolCalls")?.mapNotNull { item ->
            val tool = item as? JsonObject ?: return@mapNotNull null
            val status = tool.string("status").orEmpty()
            SyncedToolCall(
                id = tool.string("dispatchId") ?: tool.string("dispatch_id") ?: UUID.randomUUID().toString(),
                name = tool.string("toolName") ?: tool.string("tool_name") ?: tool.string("type") ?: "tool",
                status = when {
                    status.contains("fail", true) || status.contains("error", true) -> "errored"
                    status.contains("run", true) || status.contains("pend", true) ||
                        status.contains("active", true) || status.contains("start", true) -> "running"
                    else -> "completed"
                },
                summary = tool.string("result") ?: tool.string("url") ?: tool.string("command")
                    ?: tool.obj("input")?.string("command")
                    ?: tool.obj("input")?.string("url")
            )
        }.orEmpty()

        val artifactRefs = buildList {
            addAll(artifactsFromRaw(raw))
            raw.array("toolCalls")?.forEach { item ->
                (item as? JsonObject)?.let { addAll(artifactsFromRaw(it)) }
            }
        }
        // Keep only the stable Hark reference here. The WebView resolves the
        // bytes lazily through the native downloadArtifact bridge when the
        // message is actually displayed; embedding base64 here turns a chat
        // snapshot into tens of megabytes and freezes the Android WebView.
        val media = artifactRefs
            .distinctBy { it.s3Key ?: it.downloadUrl ?: it.path }
            .mapNotNull { artifact ->
                val path = artifact.s3Key ?: artifact.downloadUrl ?: artifact.path ?: return@mapNotNull null
                SyncedMediaPart(
                    kind = if (artifact.mimeType.startsWith("image/", ignoreCase = true)) "image" else "file",
                    path = path,
                    name = artifact.name,
                    mimeType = artifact.mimeType
                )
            }

        if (text.isBlank() && tools.isEmpty() && media.isEmpty()) return null
        val createdAt = raw["createdAt"]?.let { element ->
            val value = (element as? JsonPrimitive)?.contentOrNull
            value?.toDoubleOrNull()
                ?: value?.let { runCatching { Instant.parse(it).toEpochMilli().toDouble() }.getOrNull() }
        } ?: (raw["timestamp"]?.let { (it as? JsonPrimitive)?.contentOrNull?.toDoubleOrNull() })
        return SyncedMessage(
            id = if (isUser) "hark_u_$rawId" else "hark_$rawId",
            botId = botId,
            accountId = accountId,
            role = if (isUser) "user" else "bot",
            text = text,
            createdAt = createdAt ?: System.currentTimeMillis().toDouble(),
            delivery = if (isUser) "sent" else null,
            tools = tools.ifEmpty { null },
            media = media.ifEmpty { null }
        )
    }
}

/**
 * Small Kotlin port of the desktop HarkConversationSyncState reducer.
 * It intentionally keeps only message state; desktop-only activity panels can
 * be added later without changing the Android chat contract.
 */
private class HarkSyncState(private val json: Json) {
    private val messages = LinkedHashMap<String, JsonObject>()
    private val order = mutableListOf<String>()

    fun messages(): List<JsonObject> = order.mapNotNull { messages[it] }

    fun applyFrame(rawFrame: String) {
        val parsed = runCatching { json.parseToJsonElement(rawFrame) as? JsonObject }.getOrNull() ?: return
        when (parsed.string("type")) {
            "snapshot" -> applySnapshot(parsed)
            "patches" -> applyPatches(parsed)
        }
    }

    private fun applySnapshot(frame: JsonObject) {
        messages.clear()
        order.clear()
        val data = frame.obj("data") ?: return
        val messagesElement = data["messages"]
        if (messagesElement is JsonObject) {
            val map = messagesElement
            val log = data.array("log")
            if (log != null) {
                log.forEach { entry ->
                    val id = (entry as? JsonObject)?.string("id") ?: return@forEach
                    (map[id] as? JsonObject)?.let { put(id, it) }
                }
            }
            map.forEach { (id, value) ->
                if (!messages.containsKey(id) && value is JsonObject) put(id, value)
            }
        } else if (messagesElement is JsonArray) {
            messagesElement.forEach { item ->
                val message = item as? JsonObject ?: return@forEach
                val id = message.string("id") ?: return@forEach
                put(id, message)
            }
        }
    }

    private fun applyPatches(frame: JsonObject) {
        val patches = frame.array("data") ?: return
        patches.forEach { item ->
            val patch = item as? JsonObject ?: return@forEach
            when (patch.string("op")) {
                "entry_add", "message_add" -> {
                    val entry = patch.string("entry")
                    if (entry != null && entry != "message") return@forEach
                    val id = patch.string("id") ?: patch.string("messageId") ?: return@forEach
                    val value = patch.obj("value") ?: return@forEach
                    put(id, value)
                }
                "message_update" -> {
                    val id = patch.string("id") ?: patch.string("messageId") ?: return@forEach
                    val fields = patch.obj("fields") ?: return@forEach
                    val base = messages[id] ?: JsonObject(emptyMap())
                    messages[id] = withMessageId(merge(base, fields), id)
                    if (!order.contains(id)) order.add(id)
                }
                "tool_add" -> {
                    val id = patch.string("id") ?: patch.string("messageId") ?: return@forEach
                    val value = patch.obj("value") ?: return@forEach
                    val existing = messages[id] ?: return@forEach
                    val tools = (existing["toolCalls"] as? JsonArray)?.toMutableList() ?: mutableListOf()
                    val dispatch = value.string("dispatchId") ?: value.string("dispatch_id") ?: return@forEach
                    if (tools.none { (it as? JsonObject)?.string("dispatchId") == dispatch }) {
                        tools.add(value)
                        messages[id] = withToolCalls(existing, tools)
                    }
                }
                "tool_update" -> {
                    val id = patch.string("id") ?: patch.string("messageId") ?: return@forEach
                    val dispatch = patch.string("dispatchId") ?: return@forEach
                    val fields = patch.obj("fields") ?: return@forEach
                    val existing = messages[id] ?: return@forEach
                    val tools = (existing["toolCalls"] as? JsonArray)?.toMutableList() ?: return@forEach
                    val index = tools.indexOfFirst {
                        (it as? JsonObject)?.string("dispatchId") == dispatch
                    }
                    if (index >= 0) {
                        val old = tools[index] as? JsonObject ?: return@forEach
                        tools[index] = merge(old, fields)
                        messages[id] = withToolCalls(existing, tools)
                    }
                }
                "narration_update", "active_activity_set", "window_update", "ask_update",
                "panel_add", "panel_update" -> Unit
            }
        }
    }

    private fun put(id: String, value: JsonObject) {
        messages[id] = withMessageId(value, id)
        if (!order.contains(id)) order.add(id)
    }

    private fun withMessageId(value: JsonObject, id: String): JsonObject {
        if (value.string("id") != null) return value
        return buildJsonObject {
            value.forEach { (key, element) -> put(key, element) }
            put("id", JsonPrimitive(id))
        }
    }

    private fun merge(base: JsonObject, patch: JsonObject): JsonObject = buildJsonObject {
        base.forEach { (key, value) -> put(key, value) }
        patch.forEach { (key, value) -> put(key, value) }
    }

    private fun withToolCalls(base: JsonObject, tools: List<JsonElement>): JsonObject = buildJsonObject {
        base.forEach { (key, value) -> put(key, value) }
        put("toolCalls", JsonArray(tools))
    }

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }

    private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject
    private fun JsonObject.array(key: String): JsonArray? = this[key] as? JsonArray
}
