package com.qybaihe.botark.service

import android.content.Context
import com.qybaihe.botark.model.ProxyNode
import com.qybaihe.botark.model.SyncedProxyNode
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/** One vless proxy parsed from a subscription URI. */
data class MihomoNode(
    val server: String,
    val port: Int,
    val uuid: String = "",
    val tls: Boolean = false,
    val servername: String = "",
    val network: String = "tcp",
    val wsPath: String = "/",
    val wsHost: String = "",
    val realityPublicKey: String? = null,
    val realityShortId: String? = null,
    val proxyType: String = "vless",
    val username: String? = null,
    val password: String? = null,
    val id: String = "",
    val label: String = ""
)

/**
 * Parse a vless URI into a [MihomoNode], or null when it is not a usable vless endpoint.
 */
fun parseVlessNode(uri: String): MihomoNode? {
    return try {
        val u = java.net.URI(uri)
        if (!u.scheme.equals("vless", true)) return null
        val q = parseQuery(u.rawQuery)
        val tls = q["security"] == "tls" || q["security"] == "reality"
        val network = if (q["type"] == "ws") "ws" else "tcp"
        val server = u.host ?: return null
        val uuid = u.userInfo ?: return null
        MihomoNode(
            server = server,
            port = if (u.port > 0) u.port else 443,
            uuid = java.net.URLDecoder.decode(uuid, "UTF-8"),
            tls = tls,
            servername = q["sni"] ?: q["host"] ?: server,
            network = network,
            wsPath = q["path"] ?: "/",
            wsHost = q["host"] ?: q["sni"] ?: server,
            realityPublicKey = if (q["security"] == "reality") q["pbk"] else null,
            realityShortId = if (q["security"] == "reality") q["sid"] else null,
            id = "vless:" + Integer.toHexString(uri.hashCode()),
            label = server
        )
    } catch (_: Exception) {
        null
    }
}

fun parseSubscriptionProxyNode(node: ProxyNode): MihomoNode? {
    if (node.host.isBlank() || node.port !in 1..65535) return null
    val mode = node.mode.lowercase()
    if (mode != "http" && mode != "socks5" && mode != "socks5h") return null
    return MihomoNode(
        server = node.host,
        port = node.port,
        proxyType = if (mode == "http") "http" else "socks5",
        username = node.username,
        password = node.password,
        id = "sub:" + Integer.toHexString((node.mode + "://" + node.host + ":" + node.port).hashCode()),
        label = node.host + ":" + node.port
    )
}

fun parseSyncedProxyNode(node: SyncedProxyNode, desktopHost: String): MihomoNode? {
    val mode = node.mode.lowercase()
    if (mode == "vless") {
        val parsed = node.uri?.let { parseVlessNode(it) } ?: return null
        return parsed.copy(
            id = node.id.ifBlank { parsed.id },
            label = node.label.ifBlank { parsed.label }
        )
    }
    if (mode != "http" && mode != "socks5" && mode != "socks5h") return null
    val host = node.host?.takeIf { it.isNotBlank() } ?: desktopHost.takeIf { it.isNotBlank() } ?: return null
    val port = node.port
    if (port !in 1..65535) return null
    return MihomoNode(
        server = host,
        port = port,
        proxyType = if (mode == "http") "http" else "socks5",
        username = node.username,
        password = node.password,
        id = node.id,
        label = node.label
    )
}

private fun parseQuery(raw: String?): Map<String, String> {
    if (raw.isNullOrBlank()) return emptyMap()
    val out = HashMap<String, String>()
    for (pair in raw.split("&")) {
        val idx = pair.indexOf('=')
        if (idx <= 0) continue
        val k = pair.substring(0, idx)
        val v = pair.substring(idx + 1)
        out[k] = java.net.URLDecoder.decode(v, "UTF-8")
    }
    return out
}

/** Spawns the bundled mihomo core and renders its config for tun-fd based routing. */
object MihomoManager {
    private val started = AtomicBoolean(false)
    private var process: Process? = null
    private var nodes: List<MihomoNode> = emptyList()

    /** Absolute path of the bundled mihomo binary inside the APK native lib dir. */
    private fun binaryPath(ctx: Context): File? {
        val f = File(ctx.applicationInfo.nativeLibraryDir, "libmihomo.so")
        return if (f.exists()) f else null
    }

    fun isRunning(): Boolean = started.get() && process?.isAlive == true

    fun nodeCount(): Int = nodes.size

    /** Replace the node set and (re)start mihomo with the given tun fd. */
    fun startWithTun(ctx: Context, tunFd: Int, nodeList: List<MihomoNode>): Boolean {
        nodes = nodeList
        val bin = binaryPath(ctx) ?: return false
        val dir = File(ctx.filesDir, "mihomo").apply { mkdirs() }
        val cfg = File(dir, "config.yaml")
        cfg.writeText(renderConfig(tunFd, nodeList))
        stop()
        return try {
            val pb = ProcessBuilder(bin.absolutePath, "-d", dir.absolutePath, "-f", cfg.absolutePath)
                .redirectErrorStream(true)
            pb.environment()["HOME"] = ctx.filesDir.absolutePath
            process = pb.start()
            started.set(true)
            drain(process)
            true
        } catch (_: Exception) {
            started.set(false)
            false
        }
    }

    private fun drain(p: Process?) {
        Thread {
            try {
                p?.inputStream?.bufferedReader()?.use { r -> while (r.readLine() != null) { /* consume */ } }
            } catch (_: Exception) {
            }
        }.apply { isDaemon = true }.start()
    }

    fun stop() {
        try {
            process?.destroy()
        } catch (_: Exception) {
        }
        process = null
        started.set(false)
    }

    private fun renderConfig(tunFd: Int, list: List<MihomoNode>): String {
        val sb = StringBuilder()
        sb.appendLine("mixed-port: 17890")
        sb.appendLine("allow-lan: false")
        sb.appendLine("mode: rule")
        sb.appendLine("log-level: warning")
        sb.appendLine("tun:")
        sb.appendLine("  enable: true")
        sb.appendLine("  stack: system")
        sb.appendLine("  fd: $tunFd")
        sb.appendLine("  auto-route: false")
        sb.appendLine("  auto-detect-interface: false")
        sb.appendLine("dns:")
        sb.appendLine("  enable: true")
        sb.appendLine("  nameserver:")
        sb.appendLine("    - 1.1.1.1")
        sb.appendLine("    - 8.8.8.8")
        sb.appendLine("proxies:")
        if (list.isEmpty()) {
            sb.appendLine("  []")
        } else {
            list.forEachIndexed { i, n -> appendProxy(sb, n, "n$i") }
        }
        sb.appendLine("proxy-groups:")
        sb.appendLine("  - name: PROXY")
        // fallback skips dead entries in order, while the unused-first ordering
        // selected in BotArkViewModel gives "自动优选没用过的可用节点" semantics.
        sb.appendLine("    type: fallback")
        sb.appendLine("    url: http://www.gstatic.com/generate_204")
        sb.appendLine("    interval: 300")
        sb.appendLine("    proxies: [" + list.indices.joinToString(", ") { "n$it" }.ifEmpty { "" } + "]")
        sb.appendLine("rules:")
        if (list.isEmpty()) sb.appendLine("  - MATCH,DIRECT") else sb.appendLine("  - MATCH,PROXY")
        return sb.toString()
    }

    private fun appendProxy(sb: StringBuilder, n: MihomoNode, name: String) {
        sb.appendLine("  - name: $name")
        if (n.proxyType == "http" || n.proxyType == "socks5") {
            sb.appendLine("    type: " + n.proxyType)
            sb.appendLine("    server: " + n.server)
            sb.appendLine("    port: " + n.port)
            if (!n.username.isNullOrBlank()) sb.appendLine("    username: \"" + n.username.replace("\"", "\\\"") + "\"")
            if (!n.password.isNullOrBlank()) sb.appendLine("    password: \"" + n.password.replace("\"", "\\\"") + "\"")
            return
        }
        sb.appendLine("    type: vless")
        sb.appendLine("    server: " + n.server)
        sb.appendLine("    port: " + n.port)
        sb.appendLine("    uuid: " + n.uuid)
        sb.appendLine("    tls: " + n.tls)
        sb.appendLine("    servername: " + n.servername)
        sb.appendLine("    skip-cert-verify: true")
        if (n.realityPublicKey != null) {
            sb.appendLine("    reality-opts:")
            sb.appendLine("      public-key: " + n.realityPublicKey)
            sb.appendLine("      short-id: " + (n.realityShortId ?: ""))
            sb.appendLine("    client-fingerprint: chrome")
        }
        if (n.network == "ws") {
            sb.appendLine("    network: ws")
            sb.appendLine("    ws-opts:")
            sb.appendLine("      path: \"" + n.wsPath + "\"")
            sb.appendLine("      headers:")
            sb.appendLine("        Host: " + n.wsHost)
        } else {
            sb.appendLine("    network: tcp")
        }
    }
}
