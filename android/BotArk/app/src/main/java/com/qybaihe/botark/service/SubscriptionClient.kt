package com.qybaihe.botark.service

import com.qybaihe.botark.model.ProxyNode
import com.qybaihe.botark.model.SkippedNode
import com.qybaihe.botark.model.SubscriptionFetchMeta
import com.qybaihe.botark.model.SubscriptionFetchResult
import com.qybaihe.botark.model.SubscriptionFormat
import com.qybaihe.botark.model.SubscriptionParseResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URI
import java.net.URLDecoder
import java.util.Base64
import java.util.concurrent.TimeUnit

/**
 * Fetches and parses a remote proxy subscription into HTTP/SOCKS5 endpoints.
 *
 * Scope: this module fetches, parses, stores and displays subscription data only.
 * Android currently has no VpnService consumer (both OkHttp clients and WebView connect
 * directly), so parsed nodes are NOT used to route app traffic. Proxying traffic requires
 * a VpnService implementation and is tracked as follow-up work.
 */
class SubscriptionFetchException(message: String) : Exception(message)

private val PROXY_SCHEMES = setOf("vless", "ss", "vmess", "trojan", "anytls")
private val HTTP_SCHEMES = setOf("http", "https", "socks5", "socks5h")
private val BASE64_BODY = Regex("^[A-Za-z0-9+/]+={0,2}$")

class SubscriptionClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    /** GETs one subscription URL and returns its body plus non-sensitive metadata. */
    suspend fun fetch(rawUrl: String): SubscriptionFetchResult = withContext(Dispatchers.IO) {
        val url = rawUrl.trim()
        val redacted = redactSubscriptionUrl(url)
        val uri = runCatching { URI(url) }.getOrNull()
        val schemeOk = uri?.scheme?.lowercase()?.let { it == "http" || it == "https" } == true
        if (!schemeOk || uri?.host.isNullOrBlank()) {
            throw SubscriptionFetchException("订阅 URL 无效（仅支持 http/https）· " + redacted)
        }
        try {
            val req = Request.Builder()
                .url(url)
                .header("User-Agent", USER_AGENT)
                .get()
                .build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    throw SubscriptionFetchException("拉取失败（HTTP " + resp.code + "）· " + redacted)
                }
                val contentLength = resp.body?.contentLength() ?: -1L
                val body = resp.body?.string().orEmpty()
                SubscriptionFetchResult(
                    text = body,
                    meta = SubscriptionFetchMeta(
                        httpCode = resp.code,
                        contentType = resp.header("Content-Type"),
                        contentLength = contentLength,
                        redactedUrl = redacted,
                        fetchedAtMs = System.currentTimeMillis().toDouble()
                    )
                )
            }
        } catch (e: SubscriptionFetchException) {
            throw e
        } catch (e: Exception) {
            throw SubscriptionFetchException("拉取失败（网络错误）· " + redacted)
        }
    }

    companion object {
        const val USER_AGENT = "clash-verge/v2.0.3 mihomo/1.19.29"
    }
}

/** Reduces a subscription URL to scheme + host + path prefix; drops userinfo, query and fragment. */
fun redactSubscriptionUrl(raw: String): String {
    val uri = runCatching { URI(raw.trim()) }.getOrNull() ?: return "<invalid-url>"
    val scheme = uri.scheme?.lowercase() ?: return "<invalid-url>"
    val host = uri.host ?: return "<invalid-url>"
    val port = if (uri.port > 0) ":" + uri.port else ""
    val path = uri.path.orEmpty()
    val prefix = if (path.length > 24) path.take(24) + "…" else path
    return scheme + "://" + host + port + prefix
}

/** Sniffs one of four subscription formats and extracts HTTP/SOCKS5 endpoints. */
fun parseSubscription(text: String): SubscriptionParseResult {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) {
        return SubscriptionParseResult(errors = listOf("订阅内容为空"))
    }

    val compact = trimmed.filterNot { it.isWhitespace() }
    val decoded = tryDecodeBase64UriList(compact)
    if (decoded != null) {
        return parseUriLines(decoded).toResult(SubscriptionFormat.BASE64_URI_LIST)
    }

    if (trimmed.lines().any { it.trimStart().startsWith("proxies:") }) {
        return parseClashYaml(trimmed).toResult(SubscriptionFormat.CLASH_YAML)
    }

    val parsed = parseUriLines(trimmed)
    val hasProxyScheme = trimmed.lines().any {
        val s = schemeOf(it)
        s != null && s in PROXY_SCHEMES
    }
    val format = when {
        hasProxyScheme -> SubscriptionFormat.URI_LIST
        parsed.nodes.isNotEmpty() -> SubscriptionFormat.HTTP_PLAIN_LINES
        else -> SubscriptionFormat.UNKNOWN
    }
    val errors = if (format == SubscriptionFormat.UNKNOWN) {
        parsed.errors + "未识别的订阅格式"
    } else {
        parsed.errors
    }
    return SubscriptionParseResult(format, parsed.nodes, parsed.skipped, errors)
}

private class LineParse {
    val nodes = mutableListOf<ProxyNode>()
    val skipped = mutableListOf<SkippedNode>()
    val errors = mutableListOf<String>()

    fun toResult(format: String) =
        SubscriptionParseResult(format, nodes.toList(), skipped.toList(), errors.toList())
}

private fun schemeOf(line: String): String? {
    val s = line.trim()
    if (s.isEmpty() || s.startsWith("#")) return null
    val idx = s.indexOf("://")
    if (idx <= 0) return null
    return s.substring(0, idx).lowercase()
}

/** Decodes a whole-body base64 payload when it actually contains URI lines. */
private fun tryDecodeBase64UriList(compact: String): String? {
    if (compact.length < 16 || !BASE64_BODY.matches(compact)) return null
    val padded = compact + "=".repeat((4 - compact.length % 4) % 4)
    val bytes = runCatching { Base64.getDecoder().decode(padded) }.getOrNull() ?: return null
    val decoded = runCatching { String(bytes, Charsets.UTF_8) }.getOrNull() ?: return null
    if (!decoded.contains("://")) return null
    val hasKnownLine = decoded.lines().any {
        val s = schemeOf(it)
        s != null && (s in PROXY_SCHEMES || s in HTTP_SCHEMES)
    }
    return if (hasKnownLine) decoded else null
}

/** Parses newline-separated URI lines into kept endpoints, skipped proxy entries and errors. */
private fun parseUriLines(text: String): LineParse {
    val out = LineParse()
    text.lines().forEachIndexed { index, raw ->
        val line = raw.trim()
        if (line.isEmpty() || line.startsWith("#")) return@forEachIndexed
        val scheme = schemeOf(line)
        if (scheme == null) {
            out.errors.add("第 " + (index + 1) + " 行：无法识别的协议")
            return@forEachIndexed
        }
        when {
            scheme in HTTP_SCHEMES -> {
                val node = parseHttpLine(line)
                if (node != null) {
                    out.nodes.add(node)
                } else {
                    out.errors.add("第 " + (index + 1) + " 行：HTTP 端点缺少 host/port")
                }
            }
            scheme in PROXY_SCHEMES -> out.skipped.add(
                SkippedNode(scheme, "非 http 端点（" + scheme + " 协议需要 VpnService 才能消费流量）")
            )
            else -> out.errors.add("第 " + (index + 1) + " 行：无法识别的协议")
        }
    }
    return out
}

/** Converts one http/https/socks5 URI into an endpoint; credentials stay on the node only. */
private fun parseHttpLine(line: String): ProxyNode? {
    val uri = runCatching { URI(line) }.getOrNull() ?: return null
    val host = uri.host ?: return null
    val lower = uri.scheme?.lowercase()
    val port = if (uri.port > 0) uri.port else if (lower == "https") 443 else 80
    if (port !in 1..65535) return null
    val info = uri.userInfo?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrNull() }
    val pair = if (info != null) {
        val i = info.indexOf(':')
        if (i >= 0) info.substring(0, i) to info.substring(i + 1) else info to null
    } else {
        null to null
    }
    val mode = if (lower == "socks5" || lower == "socks5h") "socks5" else "http"
    return ProxyNode(
        mode = mode,
        host = host,
        port = port,
        username = pair.first?.takeIf { it.isNotEmpty() },
        password = pair.second?.takeIf { it.isNotEmpty() }
    )
}

/** Reads the proxies: block of a Clash YAML document without external YAML dependencies. */
private fun parseClashYaml(text: String): LineParse {
    val out = LineParse()
    var current: MutableMap<String, String>? = null
    var inProxies = false
    var proxiesIndent = 0

    fun putKv(target: MutableMap<String, String>, raw: String) {
        val i = raw.indexOf(':')
        if (i <= 0) return
        target[raw.substring(0, i).trim()] = raw.substring(i + 1).trim().trim('"', 39.toChar())
    }

    fun flush() {
        val map = current ?: return
        current = null
        val type = map["type"]?.lowercase().orEmpty()
        val server = map["server"]
        val port = map["port"]?.toIntOrNull()
        if (type == "http" || type == "https" || type == "socks5") {
            if (server.isNullOrBlank() || port == null || port !in 1..65535) {
                out.errors.add("Clash 条目缺少 server/port")
            } else {
                out.nodes.add(
                    ProxyNode(
                        mode = if (type == "socks5") "socks5" else "http",
                        host = server,
                        port = port,
                        username = map["username"]?.takeIf { it.isNotEmpty() },
                        password = map["password"]?.takeIf { it.isNotEmpty() }
                    )
                )
            }
        } else {
            out.skipped.add(
                SkippedNode(
                    type.ifBlank { "unknown" },
                    "非 http 端点（Clash type=" + type + " 需要 VpnService 才能消费流量）"
                )
            )
        }
    }

    for (raw in text.lines()) {
        val line = raw.trimEnd()
        if (line.isBlank()) continue
        val indent = line.indexOfFirst { !it.isWhitespace() }.coerceAtLeast(0)
        val content = line.trim()
        if (!inProxies) {
            if (content.startsWith("proxies:")) {
                inProxies = true
                proxiesIndent = indent
            }
            continue
        }
        if (indent <= proxiesIndent && !content.startsWith("-")) {
            flush()
            break
        }
        if (content.startsWith("- ")) {
            flush()
            current = mutableMapOf()
            putKv(current!!, content.removePrefix("- ").trim())
        } else {
            current?.let { putKv(it, content) }
        }
    }
    flush()
    return out
}

/** Selection report shared with the linux subscription consumer. */
data class ProxySelectionReport(
    val candidates: Int,
    val kept: Int,
    val rejected: Map<String, Int>,
    val nodes: List<ProxyNode>
)

private fun isPublicIpv4(host: String): Boolean {
    val parts = host.split(".")
    if (parts.size != 4) return false
    val nums = parts.mapNotNull { it.toIntOrNull() }
    if (nums.size != 4 || nums.any { it < 0 || it > 255 }) return false
    val a = nums[0]
    val b = nums[1]
    if (a == 10 || a == 127 || a == 0 || (a == 169 && b == 254)) return false
    if (a == 172 && b in 16..31) return false
    if (a == 192 && b == 168) return false
    if (a == 100 && b in 64..127) return false
    if (a >= 224) return false
    return true
}

/** Filter parsed endpoints by protocol, public host, port and uniqueness. */
fun selectProxyNodes(nodes: List<ProxyNode>, limit: Int = nodes.size): ProxySelectionReport {
    val rejected = mutableMapOf<String, Int>()
    fun bump(reason: String) { rejected[reason] = (rejected[reason] ?: 0) + 1 }
    val seen = HashSet<String>()
    val kept = mutableListOf<ProxyNode>()
    for (n in nodes) {
        if (n.mode != "http" && n.mode != "socks5") { bump("protocol"); continue }
        if (n.host.isBlank() || n.port !in 1..65535) { bump("host_or_port"); continue }
        if (!isPublicIpv4(n.host)) { bump("non_public_ip"); continue }
        val key = n.mode + ":" + n.host + ":" + n.port
        if (!seen.add(key)) { bump("duplicate"); continue }
        if (kept.size >= limit) { bump("limit"); continue }
        kept.add(n)
    }
    return ProxySelectionReport(nodes.size, kept.size, rejected, kept)
}