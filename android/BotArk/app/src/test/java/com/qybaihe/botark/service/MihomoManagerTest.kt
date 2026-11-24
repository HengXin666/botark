package com.qybaihe.botark.service

import com.qybaihe.botark.model.ProxyNode
import com.qybaihe.botark.model.SyncedProxyNode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class MihomoManagerTest {
    @Test
    fun parsesVlessUriWithStableIdentity() {
        val node = parseVlessNode(
            "vless://11111111-1111-1111-1111-111111111111@example.com:443?security=tls&type=ws&path=%2Fws&sni=cdn.example.com#demo"
        )
        assertNotNull(node)
        assertEquals("example.com", node!!.server)
        assertEquals("vless", node.proxyType)
        assertEquals("vless:" + Integer.toHexString(
            "vless://11111111-1111-1111-1111-111111111111@example.com:443?security=tls&type=ws&path=%2Fws&sni=cdn.example.com#demo".hashCode()
        ), node.id)
    }

    @Test
    fun buildsSocksRelayAgainstPairedDesktopHost() {
        val node = parseSyncedProxyNode(
            SyncedProxyNode(id = "relay:1", label = "本地代理 1", mode = "socks5", host = "", port = 29800, username = "u", password = "p"),
            desktopHost = "192.168.1.10"
        )
        assertNotNull(node)
        assertEquals("192.168.1.10", node!!.server)
        assertEquals(29800, node.port)
        assertEquals("socks5", node.proxyType)
        assertEquals("relay:1", node.id)
        assertEquals("u", node.username)
    }

    @Test
    fun rejectsMissingRelayHostAndPort() {
        assertNull(parseSyncedProxyNode(SyncedProxyNode(id = "x", mode = "socks5", host = "", port = 0), desktopHost = ""))
        assertNull(parseSyncedProxyNode(SyncedProxyNode(id = "x", mode = "wireguard", host = "1.1.1.1", port = 1), desktopHost = ""))
    }

    @Test
    fun parsesSubscriptionHttpAndSocksNodes() {
        val http = parseSubscriptionProxyNode(ProxyNode(mode = "http", host = "proxy.example", port = 8080, username = "u", password = "p"))
        assertNotNull(http)
        assertEquals("http", http!!.proxyType)
        assertEquals("proxy.example", http.server)
        assertEquals("u", http.username)

        val socks = parseSubscriptionProxyNode(ProxyNode(mode = "socks5h", host = "127.0.0.1", port = 1080))
        assertNotNull(socks)
        assertEquals("socks5", socks!!.proxyType)
    }
}
