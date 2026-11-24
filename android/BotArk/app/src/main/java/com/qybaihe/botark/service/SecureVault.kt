package com.qybaihe.botark.service

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.qybaihe.botark.model.DirectHermesCredential
import com.qybaihe.botark.model.HarkCredential
import com.qybaihe.botark.model.PairedDesktopInfo
import com.qybaihe.botark.model.WorkspaceSnapshot
import com.qybaihe.botark.model.SubscriptionRecord
import com.qybaihe.botark.model.SyncedProxyNode
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

/**
 * Android Keystore-backed EncryptedSharedPreferences vault for paired desktop tokens
 * and direct-connect Hermes API credentials, plus private app-storage snapshot cache.
 */
class SecureVault(private val context: Context) {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private val prefs: SharedPreferences by lazy {
        runCatching {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                "botark_secure_vault",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        }.getOrElse {
            context.getSharedPreferences("botark_vault_fallback", Context.MODE_PRIVATE)
        }
    }

    private val cacheFile: File
        get() = File(context.filesDir, "workspace-cache.json")

    fun savePairedDesktop(info: PairedDesktopInfo) {
        prefs.edit().putString(KEY_PAIRED_DESKTOP, json.encodeToString(info)).apply()
    }

    fun loadPairedDesktop(): PairedDesktopInfo? {
        val raw = prefs.getString(KEY_PAIRED_DESKTOP, null) ?: return null
        return runCatching { json.decodeFromString<PairedDesktopInfo>(raw) }.getOrNull()
    }

    fun clearPairedDesktop() {
        prefs.edit().remove(KEY_PAIRED_DESKTOP).apply()
    }

    fun saveDirectHermesCredentials(creds: List<DirectHermesCredential>) {
        prefs.edit().putString(KEY_DIRECT_HERMES, json.encodeToString(creds)).apply()
    }

    fun loadDirectHermesCredentials(): List<DirectHermesCredential> {
        val raw = prefs.getString(KEY_DIRECT_HERMES, null) ?: return emptyList()
        return runCatching { json.decodeFromString<List<DirectHermesCredential>>(raw) }.getOrDefault(emptyList())
    }

    fun clearDirectHermesCredentials() {
        prefs.edit().remove(KEY_DIRECT_HERMES).apply()
    }

    fun saveHarkCredentials(creds: List<HarkCredential>) {
        prefs.edit().putString(KEY_HARK_CREDENTIALS, json.encodeToString(creds)).apply()
    }

    fun loadHarkCredentials(): List<HarkCredential> {
        val raw = prefs.getString(KEY_HARK_CREDENTIALS, null) ?: return emptyList()
        return runCatching { json.decodeFromString<List<HarkCredential>>(raw) }.getOrDefault(emptyList())
    }

    fun clearHarkCredentials() {
        prefs.edit().remove(KEY_HARK_CREDENTIALS).apply()
    }

    fun saveSnapshotCache(snapshot: WorkspaceSnapshot) {
        runCatching {
            val tmp = File(context.filesDir, "workspace-cache.json.tmp")
            tmp.writeText(json.encodeToString(snapshot))
            tmp.renameTo(cacheFile)
        }
    }

    fun loadSnapshotCache(): WorkspaceSnapshot {
        if (!cacheFile.exists()) return WorkspaceSnapshot.EMPTY
        return runCatching {
            json.decodeFromString<WorkspaceSnapshot>(cacheFile.readText())
        }.getOrDefault(WorkspaceSnapshot.EMPTY)
    }

    fun clearSnapshotCache() {
        runCatching { cacheFile.delete() }
    }

    fun saveSubscription(record: SubscriptionRecord) {
        prefs.edit().putString(KEY_SUBSCRIPTION, json.encodeToString(record)).apply()
    }

    fun loadSubscription(): SubscriptionRecord? {
        val raw = prefs.getString(KEY_SUBSCRIPTION, null) ?: return null
        return runCatching { json.decodeFromString<SubscriptionRecord>(raw) }.getOrNull()
    }

    fun saveProxyNodes(nodes: List<SyncedProxyNode>) {
        prefs.edit().putString(KEY_PROXY_NODES, json.encodeToString(nodes)).apply()
    }

    fun loadProxyNodes(): List<SyncedProxyNode> {
        val raw = prefs.getString(KEY_PROXY_NODES, null) ?: return emptyList()
        return runCatching { json.decodeFromString<List<SyncedProxyNode>>(raw) }.getOrDefault(emptyList())
    }

    fun usedProxyNodeIds(): Set<String> {
        val raw = prefs.getString(KEY_PROXY_USAGE, null) ?: return emptySet()
        return raw.split('|').filter { it.isNotBlank() }.toSet()
    }

    fun markProxyNodeUsed(id: String) {
        if (id.isBlank()) return
        val next = (usedProxyNodeIds() + id).toList().takeLast(500)
        prefs.edit().putString(KEY_PROXY_USAGE, next.joinToString("|")).apply()
    }

    fun clearProxyNodes() {
        prefs.edit().remove(KEY_PROXY_NODES).apply()
    }

    fun clearProxyUsage() {
        prefs.edit().remove(KEY_PROXY_USAGE).apply()
    }

    companion object {
        private const val KEY_PAIRED_DESKTOP = "paired_desktop_v1"
        private const val KEY_DIRECT_HERMES = "direct_hermes_v1"
        private const val KEY_HARK_CREDENTIALS = "hark_credentials_v1"
        private const val KEY_SUBSCRIPTION = "subscription_v1"
        private const val KEY_PROXY_NODES = "proxy_nodes_v1"
        private const val KEY_PROXY_USAGE = "proxy_usage_v1"
    }
}
