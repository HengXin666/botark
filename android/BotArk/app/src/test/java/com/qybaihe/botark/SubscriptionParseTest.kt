package com.qybaihe.botark

import com.qybaihe.botark.model.SubscriptionFormat
import com.qybaihe.botark.model.ProxyNode
import com.qybaihe.botark.service.parseSubscription
import com.qybaihe.botark.service.selectProxyNodes
import com.qybaihe.botark.service.redactSubscriptionUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class SubscriptionParseTest {
    /** Plain http://user:pass@IP:port lines become HTTP/SOCKS5 endpoints. */
    @Test
    fun httpPlainLinesAreCollected() {
        val text = """
            # comment
            http://alice:s3cret@1.2.3.4:8080
            socks5://bob:p4ss@5.6.7.8:1080
        """.trimIndent()

        val result = parseSubscription(text)

        assertEquals(SubscriptionFormat.HTTP_PLAIN_LINES, result.format)
        assertEquals(2, result.nodes.size)
        assertEquals("http", result.nodes[0].mode)
        assertEquals("1.2.3.4", result.nodes[0].host)
        assertEquals(8080, result.nodes[0].port)
        assertEquals("alice", result.nodes[0].username)
        assertEquals("s3cret", result.nodes[0].password)
        assertEquals("socks5", result.nodes[1].mode)
        assertEquals(1080, result.nodes[1].port)
        assertTrue(result.skipped.isEmpty())
    }

    /** vless/ss entries are skipped with a non-HTTP reason; http lines are still kept. */
    @Test
    fun uriListSkipsNonHttpEndpoints() {
        val text = """
            vless://uuid-1234@proxy.example.com:443?encryption=none&security=tls
            ss://YWVzLTI1Ni1nY206cGFzc0BleGFtcGxlLmNvbTo4Mzg4@ss.example.com:8388
            http://u:p@9.9.9.9:3128
        """.trimIndent()

        val result = parseSubscription(text)

        assertEquals(SubscriptionFormat.URI_LIST, result.format)
        assertEquals(1, result.nodes.size)
        assertEquals("9.9.9.9", result.nodes[0].host)
        assertEquals(2, result.skipped.size)
        assertTrue(result.skipped.any { it.scheme == "vless" && it.reason.contains("非 http 端点") })
        assertTrue(result.skipped.any { it.scheme == "ss" && it.reason.contains("非 http 端点") })
        // Skipped entries must not echo the original URI (which carries credentials).
        assertFalse(result.skipped.any { it.reason.contains("uuid-1234") || it.reason.contains("YWVz") })
    }

    /** A whole-body base64 blob that decodes to URI lines is recognised. */
    @Test
    fun base64UriListIsRecognized() {
        val payload = """
            vless://uuid-abcd@base64.example.com:443
            http://user:pass@10.0.0.1:8080
        """.trimIndent()
        val encoded = Base64.getEncoder().encodeToString(payload.toByteArray(Charsets.UTF_8))

        val result = parseSubscription(encoded)

        assertEquals(SubscriptionFormat.BASE64_URI_LIST, result.format)
        assertEquals(1, result.nodes.size)
        assertEquals("10.0.0.1", result.nodes[0].host)
        assertEquals(1, result.skipped.size)
        assertEquals("vless", result.skipped[0].scheme)
    }

    /** Clash YAML proxies: block is recognised; http entries kept, vmess entries skipped. */
    @Test
    fun clashYamlIsRecognized() {
        val text = """
            mixed-port: 7890
            proxies:
              - name: "office-http"
                type: http
                server: 203.0.113.7
                port: 8080
                username: carol
                password: tok3n
              - name: vmess-node
                type: vmess
                server: 198.51.100.9
                port: 443
            rules:
              - MATCH,DIRECT
        """.trimIndent()

        val result = parseSubscription(text)

        assertEquals(SubscriptionFormat.CLASH_YAML, result.format)
        assertEquals(1, result.nodes.size)
        assertEquals("http", result.nodes[0].mode)
        assertEquals("203.0.113.7", result.nodes[0].host)
        assertEquals(8080, result.nodes[0].port)
        assertEquals("carol", result.nodes[0].username)
        assertEquals(1, result.skipped.size)
        assertEquals("vmess", result.skipped[0].scheme)
        assertTrue(result.skipped[0].reason.contains("非 http 端点"))
    }

    /** Redaction keeps host + path prefix and drops userinfo, query and fragment. */
    @Test
    fun redactUrlStripsCredentialsAndQuery() {
        val redacted = redactSubscriptionUrl(
            "https://user:secret@sub.example.com/long/subscribe/path?token=abcd1234&flag=1#frag"
        )

        assertTrue(redacted.startsWith("https://sub.example.com/long/subscribe/path"))
        assertFalse(redacted.contains("secret"))
        assertFalse(redacted.contains("token"))
        assertFalse(redacted.contains("abcd1234"))
        assertFalse(redacted.contains("frag"))
    }

    /** Selection keeps public http/socks5 endpoints and drops loopback. */
    @Test
    fun selectionKeepsOnlyPublicEndpoints() {
        val nodes = listOf(
            ProxyNode("http", "203.0.113.10", 3129, "u", "p"),
            ProxyNode("socks5", "127.0.0.1", 1080),
            ProxyNode("http", "192.168.1.5", 8080),
            ProxyNode("http", "203.0.113.10", 3129, "u", "p"),
            ProxyNode("vless", "203.0.113.11", 443)
        )
        val report = selectProxyNodes(nodes)
        assertEquals(5, report.candidates)
        assertEquals(1, report.kept)
        assertEquals(2, report.rejected["non_public_ip"] ?: 0)
        assertTrue(report.nodes[0].host.startsWith("203.0.113"))
    }
}
