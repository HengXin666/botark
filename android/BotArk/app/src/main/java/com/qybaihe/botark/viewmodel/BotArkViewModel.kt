package com.qybaihe.botark.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.qybaihe.botark.model.BridgeConnectionState
import com.qybaihe.botark.model.ConnectionStatus
import com.qybaihe.botark.model.DirectHermesCredential
import com.qybaihe.botark.model.MobileWsEnvelope
import com.qybaihe.botark.model.OfflineSyncInnerPayload
import com.qybaihe.botark.model.OfflineSyncOuterBundle
import com.qybaihe.botark.model.PairedDesktopInfo
import com.qybaihe.botark.model.PairingPayload
import com.qybaihe.botark.model.PendingApprovalItem
import com.qybaihe.botark.model.PlatformId
import com.qybaihe.botark.model.SyncedAccount
import com.qybaihe.botark.model.SyncedBot
import com.qybaihe.botark.model.SyncedGroup
import com.qybaihe.botark.model.SyncedHarkProject
import com.qybaihe.botark.model.SyncedMessage
import com.qybaihe.botark.model.WorkspaceSnapshot
import com.qybaihe.botark.service.DesktopBridgeClient
import com.qybaihe.botark.service.DesktopBridgeException
import com.qybaihe.botark.service.DirectHermesClient
import com.qybaihe.botark.service.SecureVault
import com.qybaihe.botark.service.SubscriptionClient
import com.qybaihe.botark.model.SubscriptionRecord
import com.qybaihe.botark.service.parseSubscription
import com.qybaihe.botark.service.selectProxyNodes
import com.qybaihe.botark.service.redactSubscriptionUrl
import com.qybaihe.botark.service.SyncCrypto
import com.qybaihe.botark.service.MihomoNode
import com.qybaihe.botark.service.parseSubscriptionProxyNode
import com.qybaihe.botark.service.parseSyncedProxyNode
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import java.util.UUID

data class BotArkUiState(
    val snapshot: WorkspaceSnapshot = WorkspaceSnapshot.EMPTY,
    val pairedDesktop: PairedDesktopInfo? = null,
    val directHermesCredentials: List<DirectHermesCredential> = emptyList(),
    val connectionState: BridgeConnectionState = BridgeConnectionState.Unpaired,
    val typingByBotId: Map<String, Boolean> = emptyMap(),
    val pairingBusy: Boolean = false,
    val lastError: String? = null,
    val subscriptionSummary: String = "",
    val vpnRunning: Boolean = false,
    val vpnNodeCount: Int = 0,
    val vpnMessage: String = "",
    val harkResumeLast: Boolean = true
) {
    val pendingApprovals: List<PendingApprovalItem>
        get() {
            val out = mutableListOf<PendingApprovalItem>()
            for ((accountId, items) in snapshot.approvals) {
                val bot = snapshot.bots.firstOrNull { it.activeAccountId == accountId }
                val acc = snapshot.accounts[accountId]
                val platform = bot?.platformId ?: acc?.platformId ?: PlatformId.META_MUSE
                val name = bot?.name ?: acc?.displayName?.ifBlank { null } ?: platform.displayName
                items.filter { it.status == "pending" }.forEach { apr ->
                    out.add(PendingApprovalItem(accountId, name, platform, apr))
                }
            }
            return out
        }

    val hasStandaloneBots: Boolean
        get() = directHermesCredentials.isNotEmpty() || snapshot.bots.any { it.isStandaloneWeb }

    fun directCredential(forBot: SyncedBot): DirectHermesCredential? {
        if (forBot.platformId != PlatformId.HERMES) return null
        return directHermesCredentials.firstOrNull {
            it.accountId == forBot.activeAccountId || it.botId == forBot.id
        }
    }

    fun status(forBot: SyncedBot): ConnectionStatus {
        if (forBot.isStandaloneWeb) return ConnectionStatus.ONLINE
        val acc = snapshot.accounts[forBot.activeAccountId]
        if (acc != null) {
            if (!connectionState.isBridgeConnected && forBot.platformId == PlatformId.HERMES && directCredential(forBot) != null) {
                return ConnectionStatus.ONLINE
            }
            return acc.status
        }
        return if (directCredential(forBot) != null) ConnectionStatus.ONLINE else ConnectionStatus.OFFLINE
    }

    fun canSend(toBot: SyncedBot): Boolean {
        if (toBot.isStandaloneWeb) return true
        if (connectionState.isBridgeConnected) return true
        return directCredential(toBot) != null
    }

    fun shortTransportLabel(forBot: SyncedBot): String {
        if (forBot.isStandaloneWeb) return "独立直连"
        val cs = connectionState
        if (cs is BridgeConnectionState.Connected) return "${cs.hostName} · 桥接"
        if (directCredential(forBot) != null) return "Hermes 直连"
        return "离线"
    }
}

class BotArkViewModel(application: Application) : AndroidViewModel(application) {
    private val vault = SecureVault(application)
    private val uiPrefs = application.getSharedPreferences("botark_ui_prefs", Application.MODE_PRIVATE)
    private val bridge = DesktopBridgeClient()
    private val directHermes = DirectHermesClient()
    private val json = Json { ignoreUnknownKeys = true }

    private val _uiState = MutableStateFlow(BotArkUiState())
    val uiState: StateFlow<BotArkUiState> = _uiState.asStateFlow()

    private var reconnectJob: Job? = null
    private var reconnectAttempt: Int = 0
    private val directJobs = mutableMapOf<String, Job>()

    init {
        val desktop = vault.loadPairedDesktop()
        val creds = vault.loadDirectHermesCredentials()
        val cached = vault.loadSnapshotCache()
        val savedSub = vault.loadSubscription()
        val subSummary = if (savedSub == null) "" else "上次订阅 " + savedSub.redactedUrl + "，可用节点 " + savedSub.result.nodes.size
        _uiState.value = BotArkUiState(
            snapshot = cached,
            pairedDesktop = desktop,
            directHermesCredentials = creds,
            subscriptionSummary = subSummary,
            harkResumeLast = uiPrefs.getBoolean("hark_resume_last", true),
            connectionState = if (desktop != null) {
                BridgeConnectionState.Offline(desktop.hostName)
            } else {
                BridgeConnectionState.Unpaired
            }
        )
        if (desktop != null) {
            reconnectDesktop()
        }
    }


    fun fetchSubscription(rawUrl: String) {
        val url = rawUrl.trim()
        if (url.isBlank()) return
        viewModelScope.launch {
            _uiState.update { it.copy(subscriptionSummary = "正在拉取订阅...") }
            runCatching {
                val fetched = SubscriptionClient().fetch(url)
                val parsed = parseSubscription(fetched.text)
                val selection = selectProxyNodes(parsed.nodes)
                vault.saveSubscription(SubscriptionRecord(
                    redactedUrl = redactSubscriptionUrl(url),
                    fetchedAtMs = fetched.meta.fetchedAtMs,
                    result = parsed.copy(nodes = selection.nodes)
                ))
                selection to parsed
            }.onSuccess { pair ->
                val selection = pair.first
                val parsed = pair.second
                _uiState.update {
                    it.copy(subscriptionSummary = "格式 " + parsed.format + "，候选 " + selection.candidates + "，筛选保留 " + selection.kept + "，跳过协议节点 " + parsed.skipped.size)
                }
            }.onFailure { err ->
                _uiState.update { it.copy(subscriptionSummary = "拉取失败：" + (err.message ?: "unknown error")) }
            }
        }
    }
    /** Parse saved vless protocol URIs into mihomo nodes and return them (empty if none). */
    fun loadVlessNodes(): List<MihomoNode> {
        val rec = vault.loadSubscription() ?: return emptyList()
        val out = mutableListOf<MihomoNode>()
        for (uri in rec.result.protocolUris) {
            val n = com.qybaihe.botark.service.parseVlessNode(uri)
            if (n != null) out.add(n)
        }
        return out
    }

    /** Parse saved subscription HTTP/SOCKS5 endpoints into mihomo nodes. */
    fun loadSubscriptionProxyNodes(): List<MihomoNode> {
        val rec = vault.loadSubscription() ?: return emptyList()
        return rec.result.nodes.mapNotNull { parseSubscriptionProxyNode(it) }
    }

    /**
     * "Unused first" ordering: synced portable nodes (native vless
     * URIs + authenticated desktop relays) are preferred over manual subscription
     * nodes, and nodes never used on this phone come first. The mihomo fallback
     * group then skips unreachable entries automatically.
     */
    fun loadVpnNodes(): List<MihomoNode> {
        val desktopHost = _uiState.value.pairedDesktop?.activeHost.orEmpty()
        val synced = vault.loadProxyNodes().mapNotNull { parseSyncedProxyNode(it, desktopHost) }
        val subscription = loadVlessNodes() + loadSubscriptionProxyNodes()
        val merged = (synced + subscription).distinctBy {
            it.id.ifBlank { it.proxyType + "://" + it.server + ":" + it.port }
        }
        val used = vault.usedProxyNodeIds()
        val unused = merged.filter { it.id !in used }
        return unused + merged.filter { it.id in used }
    }

    fun onVpnStarted(nodes: List<MihomoNode>) {
        nodes.firstOrNull()?.id?.let { vault.markProxyNodeUsed(it) }
        _uiState.update { it.copy(vpnRunning = true, vpnNodeCount = nodes.size, vpnMessage = "") }
    }

    fun onVpnError(msg: String) {
        _uiState.update { it.copy(vpnRunning = false, vpnMessage = msg) }
    }

    fun stopVpnProxy(context: android.content.Context) {
        runCatching {
            context.startService(android.content.Intent(context, com.qybaihe.botark.service.BotArkVpnService::class.java).setAction(com.qybaihe.botark.service.BotArkVpnService.ACTION_STOP))
        }
        _uiState.update { it.copy(vpnRunning = false, vpnMessage = "已停止") }
    }

    fun pair(rawUri: String, onSuccess: () -> Unit = {}) {
        val payload = PairingPayload.parse(rawUri)
        if (payload == null) {
            _uiState.update { it.copy(lastError = "二维码格式无效，请扫描电脑端 BotArk 配对码") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(pairingBusy = true, lastError = null) }
            try {
                val pairResult = bridge.pair(payload)
                val info = pairResult.info
                vault.savePairedDesktop(info)
                vault.saveProxyNodes(pairResult.proxyNodes)
                val mergedCreds = mergeDirectCreds(pairResult.directCredentials)
                val mergedSnap = mergeWithLocalStandalone(_uiState.value.snapshot, pairResult.snapshot)
                vault.saveSnapshotCache(mergedSnap)
                _uiState.update {
                    it.copy(
                        pairedDesktop = info,
                        directHermesCredentials = mergedCreds,
                        snapshot = mergedSnap,
                        connectionState = BridgeConnectionState.Connected(info.hostName, info.activeHost),
                        pairingBusy = false,
                        lastError = null
                    )
                }
                openLiveSocket(info)
                onSuccess()
            } catch (e: Exception) {
                _uiState.update { it.copy(pairingBusy = false, lastError = e.message ?: "配对失败") }
            }
        }
    }

    fun reconnectDesktop() {
        val desktop = _uiState.value.pairedDesktop ?: run {
            _uiState.update { it.copy(connectionState = BridgeConnectionState.Unpaired) }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(connectionState = BridgeConnectionState.Connecting, lastError = null) }
            val candidates = buildList {
                add(desktop.activeHost)
                desktop.candidateHosts.forEach { if (it !in this) add(it) }
            }
            val best = bridge.probeBestHost(candidates, desktop.port)
            if (best != null) {
                val updated = desktop.copy(activeHost = best)
                vault.savePairedDesktop(updated)
                try {
                    val fresh = mergeWithLocalStandalone(_uiState.value.snapshot, bridge.fetchSnapshot(updated))
                    vault.saveSnapshotCache(fresh)
                    reconnectAttempt = 0
                    _uiState.update {
                        it.copy(
                            pairedDesktop = updated,
                            snapshot = fresh,
                            connectionState = BridgeConnectionState.Connected(updated.hostName, best)
                        )
                    }
                    openLiveSocket(updated)
                    return@launch
                } catch (e: DesktopBridgeException) {
                    _uiState.update {
                        it.copy(
                            lastError = e.message,
                            connectionState = BridgeConnectionState.Offline(updated.hostName)
                        )
                    }
                    return@launch
                } catch (e: Exception) {
                    _uiState.update { it.copy(lastError = e.message) }
                }
            }
            _uiState.update { it.copy(connectionState = BridgeConnectionState.Offline(desktop.hostName)) }
        }
    }

    fun unpairDesktop() {
        reconnectJob?.cancel()
        reconnectJob = null
        bridge.disconnectWebSocket()
        vault.clearPairedDesktop()
        vault.clearProxyNodes()
        vault.clearProxyUsage()
        _uiState.update {
            it.copy(
                pairedDesktop = null,
                connectionState = BridgeConnectionState.Unpaired
            )
        }
    }

    fun wipeAllLocalData() {
        unpairDesktop()
        vault.clearDirectHermesCredentials()
        vault.clearSnapshotCache()
        _uiState.value = BotArkUiState()
    }

    fun importOfflineBundle(fileBytes: ByteArray, transferKey: String): Result<Int> {
        return runCatching {
            val outer = json.decodeFromString<OfflineSyncOuterBundle>(fileBytes.toString(Charsets.UTF_8))
            require(outer.format == "botark-sync-v1") { "不支持的同步包格式：${outer.format}" }
            val plain = SyncCrypto.decryptAesGcmCombined(outer.payload, transferKey).toString(Charsets.UTF_8)
            val inner = json.decodeFromString<OfflineSyncInnerPayload>(plain)
            vault.saveProxyNodes(inner.proxyNodes.orEmpty())
            val merged = mergeDirectCreds(inner.directCredentials.orEmpty())
            val mergedSnap = mergeWithLocalStandalone(_uiState.value.snapshot, inner.snapshot)
            vault.saveSnapshotCache(mergedSnap)
            _uiState.update {
                it.copy(
                    snapshot = mergedSnap,
                    directHermesCredentials = merged,
                    lastError = null
                )
            }
            mergedSnap.bots.size
        }
    }

    suspend fun addStandaloneHermes(
        name: String,
        baseUrl: String,
        apiKey: String?,
        model: String?
    ) {
        val normalized = DirectHermesClient.normalizeBaseUrl(baseUrl)
        val (_, defaultModel) = directHermes.probe(normalized, apiKey)
        val finalModel = model?.trim()?.takeIf { it.isNotEmpty() } ?: defaultModel
        val displayName = name.trim().ifEmpty { "Hermes" }
        val accountId = "acc_and_hermes_${UUID.randomUUID().toString().take(8)}"
        val botId = "bot_and_hermes_${UUID.randomUUID().toString().take(8)}"

        val cred = DirectHermesCredential(
            accountId = accountId,
            botId = botId,
            botName = displayName,
            baseUrl = normalized,
            apiKey = apiKey?.trim()?.takeIf { it.isNotEmpty() },
            model = finalModel,
            displayName = displayName
        )
        val mergedCreds = mergeDirectCreds(listOf(cred))

        _uiState.update { state ->
            val snap = state.snapshot
            val groups = if (snap.groups.isNotEmpty()) snap.groups else listOf(SyncedGroup("grp_standalone", "个人智能体"))
            val groupId = groups.first().id
            val newAccounts = snap.accounts.toMutableMap().apply {
                put(accountId, SyncedAccount(accountId, PlatformId.HERMES, displayName, normalized, ConnectionStatus.ONLINE))
            }
            val newBot = SyncedBot(
                id = botId,
                platformId = PlatformId.HERMES,
                name = displayName,
                groupId = groupId,
                activeAccountId = accountId,
                lastActivityAt = System.currentTimeMillis().toDouble()
            )
            val newMessages = snap.messages.toMutableMap().apply { putIfAbsent(botId, emptyList()) }
            val updatedSnap = snap.copy(
                groups = groups,
                accounts = newAccounts,
                bots = listOf(newBot) + snap.bots,
                messages = newMessages
            )
            vault.saveSnapshotCache(updatedSnap)
            state.copy(snapshot = updatedSnap, directHermesCredentials = mergedCreds)
        }
    }

    fun addStandaloneWebBot(
        platformId: PlatformId,
        name: String,
        customUrl: String? = null
    ): SyncedBot {
        val displayName = name.trim().ifEmpty { platformId.displayName }
        val rawUrl = customUrl?.trim()?.takeIf { it.isNotEmpty() } ?: platformId.defaultHomeUrl
        val finalUrl = if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
            rawUrl
        } else {
            "https://$rawUrl"
        }
        val host = runCatching { java.net.URI(finalUrl).host }.getOrNull().orEmpty().ifBlank { finalUrl }
        val suffix = UUID.randomUUID().toString().take(8)
        val accountId = "acc_and_${platformId.wireId}_$suffix"
        val botId = "bot_and_${platformId.wireId}_$suffix"

        val newBot = SyncedBot(
            id = botId,
            platformId = platformId,
            name = displayName,
            groupId = _uiState.value.snapshot.groups.firstOrNull()?.id ?: "grp_standalone",
            activeAccountId = accountId,
            standaloneUrl = finalUrl,
            lastActivityAt = System.currentTimeMillis().toDouble()
        )

        _uiState.update { state ->
            val snap = state.snapshot
            val groups = if (snap.groups.isNotEmpty()) snap.groups else listOf(SyncedGroup("grp_standalone", "个人智能体"))
            val groupId = groups.first().id
            val resolvedBot = newBot.copy(groupId = groupId)
            val newAccounts = snap.accounts.toMutableMap().apply {
                put(accountId, SyncedAccount(accountId, platformId, displayName, host, ConnectionStatus.ONLINE))
            }
            val newMessages = snap.messages.toMutableMap().apply { putIfAbsent(botId, emptyList()) }
            val updatedSnap = snap.copy(
                groups = groups,
                accounts = newAccounts,
                bots = listOf(resolvedBot) + snap.bots,
                messages = newMessages
            )
            vault.saveSnapshotCache(updatedSnap)
            state.copy(snapshot = updatedSnap)
        }
        return newBot
    }

    fun removeStandaloneBot(botId: String) {
        _uiState.update { state ->
            val snap = state.snapshot
            val removed = snap.bots.firstOrNull { it.id == botId } ?: return@update state
            val newBots = snap.bots.filterNot { it.id == botId }
            val newAccounts = snap.accounts.toMutableMap().apply { remove(removed.activeAccountId) }
            val newMessages = snap.messages.toMutableMap().apply { remove(botId) }
            val updatedSnap = snap.copy(bots = newBots, accounts = newAccounts, messages = newMessages)
            val updatedCreds = state.directHermesCredentials.filterNot {
                it.botId == botId || it.accountId == removed.activeAccountId
            }
            vault.saveDirectHermesCredentials(updatedCreds)
            vault.saveSnapshotCache(updatedSnap)
            state.copy(snapshot = updatedSnap, directHermesCredentials = updatedCreds)
        }
    }

    fun sendMessage(bot: SyncedBot, text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        val clientMsgId = "and_msg_${UUID.randomUUID().toString().take(10)}"
        val userMsg = SyncedMessage(
            id = clientMsgId,
            botId = bot.id,
            accountId = bot.activeAccountId,
            role = "user",
            text = trimmed,
            createdAt = System.currentTimeMillis().toDouble(),
            delivery = "sending"
        )
        appendOrUpdateMessage(bot.id, userMsg)

        val state = _uiState.value
        val desktop = state.pairedDesktop
        if (desktop != null && state.connectionState.isBridgeConnected) {
            setTyping(bot.id, true)
            viewModelScope.launch {
                try {
                    bridge.sendMessage(desktop, bot.id, trimmed, clientMsgId)
                    markDelivery(bot.id, clientMsgId, "sent", null)
                } catch (e: Exception) {
                    setTyping(bot.id, false)
                    markDelivery(bot.id, clientMsgId, "failed", e.message)
                }
            }
            return
        }

        val cred = state.directCredential(bot)
        if (cred != null) {
            markDelivery(bot.id, clientMsgId, "sent", null)
            setTyping(bot.id, true)
            directJobs[bot.id]?.cancel()
            directJobs[bot.id] = viewModelScope.launch {
                try {
                    val result = directHermes.streamChat(
                        credential = cred,
                        botId = bot.id,
                        sessionId = bot.activeSessionId,
                        text = trimmed,
                        onDelta = { msgId, partial, tools, sid ->
                            updateBotSession(bot.id, sid)
                            appendOrUpdateMessage(
                                bot.id,
                                SyncedMessage(
                                    id = msgId,
                                    botId = bot.id,
                                    accountId = bot.activeAccountId,
                                    role = "bot",
                                    text = partial,
                                    createdAt = System.currentTimeMillis().toDouble(),
                                    tools = tools.ifEmpty { null }
                                )
                            )
                        },
                        onApproval = { approvals ->
                            _uiState.update { st ->
                                val map = st.snapshot.approvals.toMutableMap()
                                map[bot.activeAccountId] = approvals
                                st.copy(snapshot = st.snapshot.copy(approvals = map))
                            }
                        }
                    )
                    updateBotSession(bot.id, result.sessionId)
                    appendOrUpdateMessage(
                        bot.id,
                        SyncedMessage(
                            id = result.messageId,
                            botId = bot.id,
                            accountId = bot.activeAccountId,
                            role = "bot",
                            text = result.finalText,
                            createdAt = System.currentTimeMillis().toDouble(),
                            tools = result.tools.ifEmpty { null }
                        )
                    )
                    setTyping(bot.id, false)
                    vault.saveSnapshotCache(_uiState.value.snapshot)
                } catch (e: Exception) {
                    setTyping(bot.id, false)
                    markDelivery(bot.id, clientMsgId, "failed", e.message)
                }
            }
            return
        }

        markDelivery(bot.id, clientMsgId, "failed", "电脑端未连接")
    }

    fun setHarkResumeLast(enabled: Boolean) {
        uiPrefs.edit().putBoolean("hark_resume_last", enabled).apply()
        _uiState.update { it.copy(harkResumeLast = enabled) }
    }

    private fun harkDesktop(): PairedDesktopInfo? {
        val state = _uiState.value
        return state.pairedDesktop?.takeIf { state.connectionState.isBridgeConnected }
    }

    fun refreshHarkProjects(bot: SyncedBot) {
        val desktop = harkDesktop() ?: run {
            _uiState.update { it.copy(lastError = "电脑端未连接，无法刷新 Hark 项目") }
            return
        }
        viewModelScope.launch {
            runCatching { bridge.harkAction(desktop, bot.id, "refresh") }
                .onFailure { e -> _uiState.update { it.copy(lastError = e.message) } }
        }
    }

    fun openHarkProject(bot: SyncedBot, project: SyncedHarkProject) {
        val desktop = harkDesktop() ?: run {
            _uiState.update { it.copy(lastError = "电脑端未连接，无法打开 Hark 项目") }
            return
        }
        viewModelScope.launch {
            runCatching {
                bridge.harkAction(
                    desktop,
                    bot.id,
                    "open",
                    project.id,
                    project.title ?: if (project.kind == "main") "主对话" else "未命名项目",
                    project.kind
                )
            }.onFailure { e -> _uiState.update { it.copy(lastError = e.message) } }
        }
    }

    fun deleteHarkProject(bot: SyncedBot, conversationId: String) {
        val desktop = harkDesktop() ?: run {
            _uiState.update { it.copy(lastError = "电脑端未连接，无法删除 Hark 项目") }
            return
        }
        viewModelScope.launch {
            runCatching { bridge.harkAction(desktop, bot.id, "delete", conversationId) }
                .onFailure { e -> _uiState.update { it.copy(lastError = e.message) } }
        }
    }

    fun showHarkProjects(bot: SyncedBot) {
        val desktop = harkDesktop() ?: run {
            _uiState.update { it.copy(lastError = "电脑端未连接") }
            return
        }
        viewModelScope.launch {
            runCatching { bridge.harkAction(desktop, bot.id, "show") }
                .onFailure { e -> _uiState.update { it.copy(lastError = e.message) } }
        }
    }

    fun stopGeneration(bot: SyncedBot) {
        setTyping(bot.id, false)
        directJobs.remove(bot.id)?.cancel()
        val desktop = _uiState.value.pairedDesktop
        if (desktop != null && _uiState.value.connectionState.isBridgeConnected) {
            viewModelScope.launch { bridge.stopGeneration(desktop, bot.id) }
        }
    }

    fun startNewSession(bot: SyncedBot) {
        val desktop = _uiState.value.pairedDesktop
        if (desktop != null && _uiState.value.connectionState.isBridgeConnected) {
            viewModelScope.launch { bridge.startNewSession(desktop, bot.id) }
        } else {
            _uiState.update { st ->
                val bots = st.snapshot.bots.map {
                    if (it.id == bot.id) it.copy(activeSessionId = null) else it
                }
                val msgs = st.snapshot.messages.toMutableMap().apply { put(bot.id, emptyList()) }
                val updated = st.snapshot.copy(bots = bots, messages = msgs)
                vault.saveSnapshotCache(updated)
                st.copy(snapshot = updated)
            }
        }
    }

    fun decideApproval(item: PendingApprovalItem, decision: String) {
        _uiState.update { st ->
            val map = st.snapshot.approvals.toMutableMap()
            map[item.accountId] = map[item.accountId].orEmpty().filterNot { it.id == item.approval.id }
            st.copy(snapshot = st.snapshot.copy(approvals = map))
        }
        val state = _uiState.value
        val desktop = state.pairedDesktop
        viewModelScope.launch {
            if (desktop != null && state.connectionState.isBridgeConnected) {
                runCatching {
                    bridge.decideApproval(desktop, item.accountId, item.platformId, item.approval.id, decision)
                }
            } else if (item.platformId == PlatformId.HERMES) {
                state.directHermesCredentials.firstOrNull { it.accountId == item.accountId }?.let { cred ->
                    runCatching { directHermes.decideApproval(cred, item.approval.id, decision) }
                }
            }
        }
    }

    private fun openLiveSocket(desktop: PairedDesktopInfo) {
        reconnectJob?.cancel()
        bridge.connectWebSocket(
            desktop = desktop,
            onEvent = { env -> handleWsEnvelope(env) },
            onDisconnect = {
                val current = _uiState.value.pairedDesktop ?: return@connectWebSocket
                _uiState.update { it.copy(connectionState = BridgeConnectionState.Offline(current.hostName)) }
                reconnectJob?.cancel()
                reconnectAttempt = (reconnectAttempt + 1).coerceAtMost(4)
                val delayMs = (3_000L shl (reconnectAttempt - 1).coerceAtLeast(0)).coerceAtMost(24_000L)
                reconnectJob = viewModelScope.launch {
                    delay(delayMs)
                    if (_uiState.value.pairedDesktop != null) reconnectDesktop()
                }
            }
        )
    }

    private fun handleWsEnvelope(env: MobileWsEnvelope) {
        when (env.type) {
            "snapshot" -> env.snapshot?.let { snap ->
                val mergedSnap = mergeWithLocalStandalone(_uiState.value.snapshot, snap)
                vault.saveSnapshotCache(mergedSnap)
                _uiState.update { it.copy(snapshot = mergedSnap) }
            }
            "message_delta" -> {
                val botId = env.botId ?: return
                val msgId = env.messageId ?: return
                setTyping(botId, true)
                appendOrUpdateMessage(
                    botId,
                    SyncedMessage(
                        id = msgId,
                        botId = botId,
                        accountId = env.accountId.orEmpty(),
                        role = "bot",
                        text = env.text.orEmpty(),
                        createdAt = System.currentTimeMillis().toDouble(),
                        tools = env.tools,
                        media = env.media
                    )
                )
            }
            "message" -> {
                val botId = env.botId ?: return
                val msg = env.message ?: return
                setTyping(botId, false)
                appendOrUpdateMessage(botId, msg)
                vault.saveSnapshotCache(_uiState.value.snapshot)
            }
            "typing" -> {
                val botId = env.botId ?: return
                env.isTyping?.let { setTyping(botId, it) }
            }
            "status" -> {
                val accId = env.accountId ?: return
                val st = env.status ?: return
                _uiState.update { state ->
                    val existing = state.snapshot.accounts[accId] ?: return@update state
                    val map = state.snapshot.accounts.toMutableMap()
                    map[accId] = existing.copy(status = st, statusDetail = env.detail)
                    state.copy(snapshot = state.snapshot.copy(accounts = map))
                }
            }
            "approvals" -> {
                val accId = env.accountId ?: return
                val pending = env.pending ?: return
                _uiState.update { state ->
                    val map = state.snapshot.approvals.toMutableMap()
                    map[accId] = pending
                    state.copy(snapshot = state.snapshot.copy(approvals = map))
                }
            }
        }
    }

    private fun mergeWithLocalStandalone(
        current: WorkspaceSnapshot,
        incomingRaw: WorkspaceSnapshot
    ): WorkspaceSnapshot {
        // Desktop snapshots carry group names + collapsed state. Older peers only
        // send bot.groupId; synthesise readable sections so scan-sync never drops
        // grouping information on the floor.
        val incoming = ensureGroups(incomingRaw)
        val incomingIds = incoming.bots.mapTo(hashSetOf()) { it.id }
        val localOnly = current.bots.filter {
            (it.isStandaloneWeb || it.id.startsWith("bot_and_")) && it.id !in incomingIds
        }
        if (localOnly.isEmpty()) return incoming
        val localOnlyGroupIds = localOnly.mapTo(hashSetOf()) { it.groupId }
        val localGroups = current.groups.filter { group ->
            group.id in localOnlyGroupIds && incoming.groups.none { it.id == group.id }
        }
        val groups = (incoming.groups + localGroups).ifEmpty {
            listOf(SyncedGroup("grp_standalone", "个人智能体"))
        }
        val fallbackGroupId = groups.first().id
        val groupIds = groups.mapTo(hashSetOf()) { it.id }
        val accounts = incoming.accounts.toMutableMap()
        val messages = incoming.messages.toMutableMap()
        val extraBots = localOnly.map { bot ->
            current.accounts[bot.activeAccountId]?.let { accounts[bot.activeAccountId] = it }
            current.messages[bot.id]?.let { messages[bot.id] = it }
            if (bot.groupId in groupIds) bot else bot.copy(groupId = fallbackGroupId)
        }
        return incoming.copy(
            groups = groups,
            accounts = accounts,
            bots = incoming.bots + extraBots,
            messages = messages
        )
    }

    private fun ensureGroups(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
        if (snapshot.groups.isNotEmpty()) return snapshot
        val ids = snapshot.bots.map { it.groupId }.filter { it.isNotBlank() }.distinct()
        if (ids.isEmpty()) return snapshot
        // A single implicit "default" group is the old flat-list format.
        if (ids.size == 1 && ids.first() == "default") return snapshot
        return snapshot.copy(
            groups = ids.map { id ->
                SyncedGroup(
                    id = id,
                    name = if (id == "default") "默认分组" else id.take(18)
                )
            }
        )
    }

    private fun mergeDirectCreds(incoming: List<DirectHermesCredential>): List<DirectHermesCredential> {
        if (incoming.isEmpty()) return _uiState.value.directHermesCredentials
        val map = _uiState.value.directHermesCredentials.associateBy { it.accountId }.toMutableMap()
        incoming.forEach { map[it.accountId] = it }
        val merged = map.values.toList()
        vault.saveDirectHermesCredentials(merged)
        return merged
    }

    private fun appendOrUpdateMessage(botId: String, msg: SyncedMessage) {
        _uiState.update { st ->
            val list = st.snapshot.messages[botId].orEmpty().toMutableList()
            val idx = list.indexOfFirst { it.id == msg.id }
            if (idx >= 0) list[idx] = msg else list.add(msg)
            val map = st.snapshot.messages.toMutableMap().apply { put(botId, list) }
            st.copy(snapshot = st.snapshot.copy(messages = map))
        }
    }

    private fun markDelivery(botId: String, messageId: String, delivery: String, error: String?) {
        _uiState.update { st ->
            val list = st.snapshot.messages[botId].orEmpty().map {
                if (it.id == messageId) it.copy(delivery = delivery, error = error) else it
            }
            val map = st.snapshot.messages.toMutableMap().apply { put(botId, list) }
            st.copy(snapshot = st.snapshot.copy(messages = map))
        }
    }

    private fun setTyping(botId: String, typing: Boolean) {
        _uiState.update { st ->
            val map = st.typingByBotId.toMutableMap().apply { put(botId, typing) }
            st.copy(typingByBotId = map)
        }
    }

    private fun updateBotSession(botId: String, sessionId: String?) {
        if (sessionId.isNullOrBlank()) return
        _uiState.update { st ->
            val bots = st.snapshot.bots.map {
                if (it.id == botId) it.copy(activeSessionId = sessionId) else it
            }
            st.copy(snapshot = st.snapshot.copy(bots = bots))
        }
    }

    override fun onCleared() {
        bridge.disconnectWebSocket()
        super.onCleared()
    }
}
