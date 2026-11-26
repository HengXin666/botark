package com.qybaihe.botark.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.qybaihe.botark.model.BridgeConnectionState
import com.qybaihe.botark.model.ConnectionStatus
import com.qybaihe.botark.model.DirectHermesCredential
import com.qybaihe.botark.model.HarkCredential
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
import com.qybaihe.botark.service.HarkDirectClient
import com.qybaihe.botark.service.HarkDirectException
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
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.time.Instant
import java.util.UUID

data class BotArkUiState(
    val snapshot: WorkspaceSnapshot = WorkspaceSnapshot.EMPTY,
    val pairedDesktop: PairedDesktopInfo? = null,
    val directHermesCredentials: List<DirectHermesCredential> = emptyList(),
    val harkCredentials: List<HarkCredential> = emptyList(),
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
        get() = directHermesCredentials.isNotEmpty() || harkCredentials.isNotEmpty() ||
            snapshot.bots.any { it.isStandaloneWeb }

    fun directCredential(forBot: SyncedBot): DirectHermesCredential? {
        if (forBot.platformId != PlatformId.HERMES) return null
        return directHermesCredentials.firstOrNull {
            it.accountId == forBot.activeAccountId || it.botId == forBot.id
        }
    }

    fun harkCredential(forBot: SyncedBot): HarkCredential? {
        if (forBot.platformId != PlatformId.HARK) return null
        return harkCredentials.firstOrNull { it.accountId == forBot.activeAccountId }
    }

    fun status(forBot: SyncedBot): ConnectionStatus {
        if (forBot.isStandaloneWeb) return ConnectionStatus.ONLINE
        if (forBot.platformId == PlatformId.HARK && harkCredential(forBot) != null) {
            val acc = snapshot.accounts[forBot.activeAccountId]
            return when (acc?.status) {
                ConnectionStatus.BUSY -> ConnectionStatus.BUSY
                ConnectionStatus.ERROR -> ConnectionStatus.ERROR
                else -> ConnectionStatus.ONLINE
            }
        }
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
        if (toBot.platformId == PlatformId.HARK && harkCredential(toBot) != null) return true
        if (connectionState.isBridgeConnected) return true
        return directCredential(toBot) != null
    }

    fun shortTransportLabel(forBot: SyncedBot): String {
        if (forBot.isStandaloneWeb) return "独立直连"
        if (forBot.platformId == PlatformId.HARK && harkCredential(forBot) != null) return "Hark 直连"
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
    private val harkDirect = HarkDirectClient()
    private val json = Json { ignoreUnknownKeys = true }

    private val _uiState = MutableStateFlow(BotArkUiState())
    val uiState: StateFlow<BotArkUiState> = _uiState.asStateFlow()

    private var reconnectJob: Job? = null
    private var reconnectAttempt: Int = 0
    private var harkStatusJob: Job? = null
    private val directJobs = mutableMapOf<String, Job>()
    private val harkWatchJobs = mutableMapOf<String, Job>()
    /** One independent poll loop per Hark bot, so a slow/dead account cannot
     *  block every other account behind a batch barrier. */
    private val harkPollJobs = mutableMapOf<String, Job>()
    /** At least ten status requests in flight; excess loops wait here. */
    private val harkPollLimiter = Semaphore(10)

    init {
        val desktop = vault.loadPairedDesktop()
        val creds = vault.loadDirectHermesCredentials()
        val harkCreds = vault.loadHarkCredentials()
        val cached = sanitizeSnapshotForBridge(vault.loadSnapshotCache())
        val savedSub = vault.loadSubscription()
        val subSummary = if (savedSub == null) "" else "上次订阅 " + savedSub.redactedUrl + "，可用节点 " + savedSub.result.nodes.size
        _uiState.value = BotArkUiState(
            snapshot = cached,
            pairedDesktop = desktop,
            directHermesCredentials = creds,
            harkCredentials = harkCreds,
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
        ensureHarkStatusPoller()
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
                val mergedHarkCreds = mergeHarkCreds(pairResult.harkCredentials)
                val mergedSnap = mergeWithLocalStandalone(_uiState.value.snapshot, pairResult.snapshot)
                vault.saveSnapshotCache(mergedSnap)
                _uiState.update {
                    it.copy(
                        pairedDesktop = info,
                        directHermesCredentials = mergedCreds,
                        harkCredentials = mergedHarkCreds,
                        snapshot = mergedSnap,
                        connectionState = BridgeConnectionState.Connected(info.hostName, info.activeHost),
                        pairingBusy = false,
                        lastError = null
                    )
                }
                openLiveSocket(info)
                ensureHarkStatusPoller()
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
        stopHarkPollers()
        unpairDesktop()
        vault.clearDirectHermesCredentials()
        vault.clearHarkCredentials()
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
            val updatedHarkCreds = state.harkCredentials.filterNot {
                it.accountId == removed.activeAccountId
            }
            vault.saveDirectHermesCredentials(updatedCreds)
            vault.saveHarkCredentials(updatedHarkCreds)
            vault.saveSnapshotCache(updatedSnap)
            state.copy(
                snapshot = updatedSnap,
                directHermesCredentials = updatedCreds,
                harkCredentials = updatedHarkCreds
            )
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
        val harkCred = state.harkCredential(bot)
        if (harkCred != null) {
            sendDirectHark(bot, harkCred, clientMsgId, trimmed)
            return
        }
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

    private fun sendDirectHark(
        bot: SyncedBot,
        cred: HarkCredential,
        clientMsgId: String,
        text: String
    ) {
        directJobs[bot.id]?.cancel()
        directJobs[bot.id] = viewModelScope.launch {
            setTyping(bot.id, true)
            updateHarkActivity(bot, true)
            try {
                var conversationId = bot.activeSessionId?.takeIf { it.isNotBlank() }
                    ?: harkDirect.mainConversationId(cred)
                    ?: throw Exception("Hark 没有可用的对话")
                val currentConversation = _uiState.value.snapshot.bots
                    .firstOrNull { it.id == bot.id }?.activeSessionId
                if (currentConversation != null && currentConversation != conversationId) {
                    markDelivery(bot.id, clientMsgId, "failed", "已切换项目")
                    return@launch
                }
                updateBotSession(bot.id, conversationId)
                val baseline = runCatching {
                    harkDirect.fetchMessages(cred, conversationId, bot.id, bot.activeAccountId)
                }.getOrNull()
                if (!baseline.isNullOrEmpty() && isActiveHarkConversation(bot.id, conversationId)) {
                    applyHarkMessages(bot.id, baseline)
                }
                val beforeIds = (_uiState.value.snapshot.messages[bot.id].orEmpty() + baseline.orEmpty())
                    .filter { it.id != clientMsgId }
                    .mapTo(hashSetOf()) { it.id }
                harkDirect.sendMessage(cred, conversationId, text)
                markDelivery(bot.id, clientMsgId, "sent", null)
                setHarkProjectWorking(bot.id, conversationId, true)
                val finalMessages = harkDirect.awaitReply(
                    cred = cred,
                    conversationId = conversationId,
                    botId = bot.id,
                    accountId = bot.activeAccountId,
                    afterIds = beforeIds
                ) { messages, working ->
                    if (isActiveHarkConversation(bot.id, conversationId)) {
                        applyHarkMessages(bot.id, messages)
                        setTyping(bot.id, working)
                        updateHarkActivity(bot, working)
                    }
                }
                if (isActiveHarkConversation(bot.id, conversationId)) {
                    applyHarkMessages(bot.id, finalMessages)
                    setTyping(bot.id, false)
                    updateHarkActivity(bot, false)
                    vault.saveSnapshotCache(_uiState.value.snapshot)
                }
                setHarkProjectWorking(bot.id, conversationId, false)
            } catch (e: Exception) {
                setTyping(bot.id, false)
                updateHarkActivity(bot, false)
                markDelivery(bot.id, clientMsgId, "failed", e.message ?: "Hark 直连失败")
                if (e is HarkDirectException && (e.status == 401 || e.status == 403)) {
                    markHarkAuthExpired(bot.id)
                } else {
                    _uiState.update { it.copy(lastError = e.message ?: "Hark 直连失败") }
                }
            }
        }
    }

    private fun applyHarkMessages(botId: String, incoming: List<SyncedMessage>) {
        _uiState.update { st ->
            val local = st.snapshot.messages[botId].orEmpty()
            if (incoming.isEmpty() && local.isNotEmpty()) return@update st
            val keep = local.filter { it.delivery == "sending" || it.delivery == "failed" }
                .filterNot { localMsg ->
                    localMsg.isUser && incoming.any {
                        it.isUser && it.text.trim() == localMsg.text.trim()
                    }
                }
            val merged = incoming + keep
            val map = st.snapshot.messages.toMutableMap().apply { put(botId, merged) }
            st.copy(snapshot = st.snapshot.copy(messages = map))
        }
    }

    private fun isActiveHarkConversation(botId: String, conversationId: String): Boolean =
        _uiState.value.snapshot.bots.firstOrNull { it.id == botId }?.activeSessionId == conversationId

    private fun setHarkProjectWorking(botId: String, conversationId: String, working: Boolean) {
        _uiState.update { st ->
            val bots = st.snapshot.bots.map { bot ->
                if (bot.id != botId) bot else bot.copy(
                    harkProjects = bot.harkProjects.map { project ->
                        if (project.id == conversationId) {
                            project.copy(status = if (working) "working" else null)
                        } else project
                    }
                )
            }
            st.copy(snapshot = st.snapshot.copy(bots = bots))
        }
    }

    private fun ensureHarkStatusPoller() {
        if (harkStatusJob?.isActive == true) return
        if (_uiState.value.harkCredentials.isEmpty()) return
        harkStatusJob = viewModelScope.launch {
            while (true) {
                reconcileHarkPollers()
                // New/removed Hark bots are picked up within one reconciliation tick.
                delay(10_000)
            }
        }
    }

    /**
     * Give every Hark bot its own polling loop. The old chunked sweep waited
     * for the slowest request in each batch; with 80 accounts and a dead proxy
     * that made the last accounts look unmonitored for minutes. Independent
     * loops plus a 10-permit limiter keep at least ten accounts live without
     * letting one 95s timeout stall the others.
     */
    private fun reconcileHarkPollers() {
        val bots = _uiState.value.snapshot.bots.filter { it.platformId == PlatformId.HARK }
        val liveIds = bots.mapTo(hashSetOf()) { it.id }
        for (id in harkPollJobs.keys.filter { it !in liveIds }) {
            harkPollJobs.remove(id)?.cancel()
        }
        for (bot in bots) {
            if (harkPollJobs[bot.id]?.isActive == true) continue
            harkPollJobs[bot.id] = viewModelScope.launch {
                while (true) {
                    val working = pollHarkStatus(bot.id)
                    // Working accounts get a fast loop until their task ends;
                    // idle accounts stay on the 10s sweep.
                    delay(if (working) 3_000 else 10_000)
                }
            }
        }
    }

    private suspend fun pollHarkStatus(botId: String): Boolean {
        val st = _uiState.value
        val bot = st.snapshot.bots.firstOrNull { it.id == botId } ?: return false
        val cred = st.harkCredential(bot) ?: return false
        return try {
            val statuses = harkPollLimiter.withPermit { harkDirect.listStatuses(cred) }
            applyHarkStatuses(botId, statuses)
            statuses.values.any { it.equals("working", ignoreCase = true) }
        } catch (e: HarkDirectException) {
            if (e.status == 401 || e.status == 403) markHarkAuthExpired(botId)
            false
        } catch (_: Exception) {
            // One expired/broken account must not stop the other poll loops.
            false
        }
    }

    private fun stopHarkPollers() {
        harkStatusJob?.cancel()
        harkStatusJob = null
        for (job in harkPollJobs.values) job.cancel()
        harkPollJobs.clear()
    }

    private fun markHarkAuthExpired(botId: String) {
        _uiState.update { st ->
            val bot = st.snapshot.bots.firstOrNull { it.id == botId } ?: return@update st
            val account = st.snapshot.accounts[bot.activeAccountId] ?: return@update st
            val accounts = st.snapshot.accounts.toMutableMap().apply {
                put(
                    bot.activeAccountId,
                    account.copy(status = ConnectionStatus.ERROR, statusDetail = "Hark 登录已失效，请重新扫码")
                )
            }
            st.copy(
                snapshot = st.snapshot.copy(accounts = accounts),
                lastError = "Hark 登录已失效，请重新扫码同步账号"
            )
        }
    }

    private fun applyHarkStatuses(botId: String, statuses: Map<String, String>) {
        val working = statuses.values.any { it.equals("working", ignoreCase = true) }
        _uiState.update { st ->
            val target = st.snapshot.bots.firstOrNull { it.id == botId } ?: return@update st
            val bots = st.snapshot.bots.map { bot ->
                if (bot.id != botId) bot else bot.copy(
                    harkProjects = bot.harkProjects.map { project ->
                        project.copy(status = statuses[project.id])
                    },
                    activityBusy = working,
                    activityText = if (working) "正在工作…" else null
                )
            }
            val account = st.snapshot.accounts[target.activeAccountId]
            val accounts = if (account != null) {
                st.snapshot.accounts.toMutableMap().apply {
                    put(
                        target.activeAccountId,
                        account.copy(status = if (working) ConnectionStatus.BUSY else ConnectionStatus.ONLINE)
                    )
                }
            } else st.snapshot.accounts
            st.copy(snapshot = st.snapshot.copy(bots = bots, accounts = accounts))
        }
    }

    private fun updateHarkActivity(bot: SyncedBot, busy: Boolean) {
        _uiState.update { st ->
            val bots = st.snapshot.bots.map {
                if (it.id == bot.id) {
                    it.copy(activityBusy = busy, activityText = if (busy) "正在工作…" else null)
                } else it
            }
            val account = st.snapshot.accounts[bot.activeAccountId]
            val accounts = if (account != null) {
                st.snapshot.accounts.toMutableMap().apply {
                    put(bot.activeAccountId, account.copy(status = if (busy) ConnectionStatus.BUSY else ConnectionStatus.ONLINE))
                }
            } else st.snapshot.accounts
            st.copy(snapshot = st.snapshot.copy(bots = bots, accounts = accounts))
        }
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
        val cred = _uiState.value.harkCredential(bot)
        if (cred != null) {
            viewModelScope.launch {
                runCatching {
                    val projects = harkDirect.listProjects(cred)
                    // A failed status request must not be treated as "all idle":
                    // keep the cached working state instead of clearing it.
                    val statuses = runCatching { harkDirect.listStatuses(cred) }.getOrNull()
                    val cached = _uiState.value.snapshot.bots
                        .firstOrNull { it.id == bot.id }
                        ?.harkProjects
                        .orEmpty()
                        .associateBy { it.id }
                    val withStatus = projects.map { project ->
                        project.copy(status = statuses?.get(project.id) ?: cached[project.id]?.status)
                    }
                    val working = withStatus.any { it.status.equals("working", ignoreCase = true) }
                    _uiState.update { st ->
                        val bots = st.snapshot.bots.map {
                            if (it.id == bot.id) it.copy(
                                harkProjects = withStatus,
                                activityBusy = working,
                                activityText = if (working) "正在工作…" else null
                            ) else it
                        }
                        val account = st.snapshot.accounts[bot.activeAccountId]
                        val accounts = if (account != null) {
                            st.snapshot.accounts.toMutableMap().apply {
                                put(
                                    bot.activeAccountId,
                                    account.copy(status = if (working) ConnectionStatus.BUSY else ConnectionStatus.ONLINE, statusDetail = null)
                                )
                            }
                        } else st.snapshot.accounts
                        st.copy(snapshot = st.snapshot.copy(bots = bots, accounts = accounts), lastError = null)
                    }
                    vault.saveSnapshotCache(_uiState.value.snapshot)
                }.onFailure { e ->
                    if (e is HarkDirectException && (e.status == 401 || e.status == 403)) {
                        markHarkAuthExpired(bot.id)
                    } else {
                        _uiState.update { it.copy(lastError = e.message ?: "Hark 项目刷新失败") }
                    }
                }
            }
            return
        }
        val desktop = harkDesktop() ?: run {
            _uiState.update { it.copy(lastError = "电脑端未连接，且手机没有 Hark 登录凭据") }
            return
        }
        viewModelScope.launch {
            runCatching { bridge.harkAction(desktop, bot.id, "refresh") }
                .onFailure { e -> _uiState.update { it.copy(lastError = e.message) } }
        }
    }

    fun openHarkProject(bot: SyncedBot, project: SyncedHarkProject) {
        val cred = _uiState.value.harkCredential(bot)
        if (cred != null) {
            directJobs.remove(bot.id)?.cancel()
            setTyping(bot.id, false)
            updateHarkActivity(bot, false)
            viewModelScope.launch {
                _uiState.update { st ->
                    val bots = st.snapshot.bots.map {
                        if (it.id == bot.id) it.copy(
                            activeSessionId = project.id,
                            activeSessionTitle = project.title ?: if (project.kind == "main") "主对话" else "未命名项目",
                            activeSessionKind = project.kind,
                            harkProjectsOpen = false
                        ) else it
                    }
                    val messages = st.snapshot.messages.toMutableMap().apply { put(bot.id, emptyList()) }
                    st.copy(snapshot = st.snapshot.copy(bots = bots, messages = messages), lastError = null)
                }
                runCatching {
                    val messages = harkDirect.fetchMessages(cred, project.id, bot.id, bot.activeAccountId)
                    if (isActiveHarkConversation(bot.id, project.id)) {
                        applyHarkMessages(bot.id, messages)
                        harkDirect.markViewed(cred, project.id)
                        vault.saveSnapshotCache(_uiState.value.snapshot)
                    }
                }.onFailure { e ->
                    _uiState.update { it.copy(lastError = e.message ?: "Hark 项目加载失败") }
                }
            }
            return
        }
        val desktop = harkDesktop() ?: run {
            _uiState.update { it.copy(lastError = "电脑端未连接，且手机没有 Hark 登录凭据") }
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
        val cred = _uiState.value.harkCredential(bot)
        if (cred != null) {
            viewModelScope.launch {
                runCatching {
                    harkDirect.deleteProject(cred, conversationId)
                    _uiState.update { st ->
                        val bots = st.snapshot.bots.map {
                            if (it.id != bot.id) it else it.copy(
                                harkProjects = it.harkProjects.filter { project -> project.id != conversationId },
                                activeSessionId = if (it.activeSessionId == conversationId) null else it.activeSessionId,
                                activeSessionTitle = if (it.activeSessionId == conversationId) null else it.activeSessionTitle,
                                activeSessionKind = if (it.activeSessionId == conversationId) null else it.activeSessionKind,
                                harkProjectsOpen = if (it.activeSessionId == conversationId) true else it.harkProjectsOpen
                            )
                        }
                        val messages = st.snapshot.messages.toMutableMap().apply {
                            if (bot.activeSessionId == conversationId) put(bot.id, emptyList())
                        }
                        st.copy(snapshot = st.snapshot.copy(bots = bots, messages = messages), lastError = null)
                    }
                    vault.saveSnapshotCache(_uiState.value.snapshot)
                }.onFailure { e -> _uiState.update { it.copy(lastError = e.message ?: "Hark 项目删除失败") } }
            }
            return
        }
        val desktop = harkDesktop() ?: run {
            _uiState.update { it.copy(lastError = "电脑端未连接，且手机没有 Hark 登录凭据") }
            return
        }
        viewModelScope.launch {
            runCatching { bridge.harkAction(desktop, bot.id, "delete", conversationId) }
                .onFailure { e -> _uiState.update { it.copy(lastError = e.message) } }
        }
    }

    fun showHarkProjects(bot: SyncedBot) {
        if (_uiState.value.harkCredential(bot) != null) {
            _uiState.update { st ->
                val bots = st.snapshot.bots.map {
                    if (it.id == bot.id) it.copy(harkProjectsOpen = true) else it
                }
                st.copy(snapshot = st.snapshot.copy(bots = bots), lastError = null)
            }
            return
        }
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
        val cred = _uiState.value.harkCredential(bot)
        if (cred != null && bot.activeSessionId != null) {
            viewModelScope.launch { harkDirect.pauseAgent(cred, bot.activeSessionId) }
            return
        }
        val desktop = _uiState.value.pairedDesktop
        if (desktop != null && _uiState.value.connectionState.isBridgeConnected) {
            viewModelScope.launch { bridge.stopGeneration(desktop, bot.id) }
        }
    }

    fun startNewSession(bot: SyncedBot) {
        val cred = _uiState.value.harkCredential(bot)
        if (cred != null) {
            directJobs.remove(bot.id)?.cancel()
            setTyping(bot.id, false)
            updateHarkActivity(bot, false)
            viewModelScope.launch {
                val main = runCatching { harkDirect.mainConversationId(cred) }.getOrNull()
                if (main != null) {
                    val current = _uiState.value.snapshot.bots
                        .firstOrNull { it.id == bot.id }?.activeSessionId
                    if (current != null && current != main) return@launch
                    updateBotSession(bot.id, main)
                    val messages = runCatching {
                        harkDirect.fetchMessages(cred, main, bot.id, bot.activeAccountId)
                    }.getOrDefault(emptyList())
                    if (isActiveHarkConversation(bot.id, main)) applyHarkMessages(bot.id, messages)
                }
            }
            return
        }
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

    // ---- Android WebView bridge -------------------------------------------------

    /**
     * Older builds embedded downloaded Hark screenshots as base64 in message
     * media. Those snapshots are tens of megabytes and make the WebView go
     * blank, so strip inline data URLs at the bridge boundary as well as in
     * HarkDirectClient.
     */
    private fun sanitizeSnapshotForBridge(snapshot: WorkspaceSnapshot): WorkspaceSnapshot = snapshot.copy(
        messages = snapshot.messages.mapValues { (_, list) -> list.map(::sanitizeMessageForBridge) }
    )

    /** Full workspace + native UI state for the React shell in the WebView. */
    fun bridgeStateJson(): String {
        val st = _uiState.value
        val snapshotJson = json.parseToJsonElement(
            json.encodeToString(WorkspaceSnapshot.serializer(), sanitizeSnapshotForBridge(st.snapshot))
        )
        val connection = st.connectionState
        val connectionLabel = when (connection) {
            is BridgeConnectionState.Connected -> "${connection.hostName} · 桥接"
            is BridgeConnectionState.Connecting -> "连接中"
            is BridgeConnectionState.Offline -> if (st.hasStandaloneBots) "独立运行" else "${connection.hostName} 离线"
            is BridgeConnectionState.Unpaired -> if (st.hasStandaloneBots) "独立运行" else "未配对"
        }
        val approvals = buildJsonArray {
            st.pendingApprovals.forEach { item ->
                val botId = st.snapshot.bots.firstOrNull { it.activeAccountId == item.accountId }?.id ?: ""
                add(buildJsonObject {
                    put("accountId", item.accountId)
                    put("botId", botId)
                    put("platformId", item.platformId.wireId)
                    put("id", item.approval.id)
                    put("title", item.approval.title)
                    item.approval.detail?.let { put("detail", it) }
                    item.approval.host?.let { put("host", it) }
                    item.approval.reason?.let { put("reason", it) }
                    item.approval.decisionOptions?.takeIf { it.isNotEmpty() }?.let { options ->
                        put("decisionOptions", buildJsonArray { options.forEach { add(JsonPrimitive(it)) } })
                    }
                })
            }
        }
        return buildJsonObject {
            put("snapshot", snapshotJson)
            put("typingByBotId", buildJsonObject { st.typingByBotId.forEach { (id, value) -> put(id, value) } })
            put("connection", buildJsonObject {
                put("connected", connection.isBridgeConnected || st.hasStandaloneBots)
                put("label", connectionLabel)
            })
            put("hasStandaloneBots", st.hasStandaloneBots)
            put("harkResumeLast", st.harkResumeLast)
            put("approvals", approvals)
        }.toString()
    }

    /** Compact command channel used by the WebView shell for user actions. */
    fun bridgeCommand(action: String, argsJson: String) {
        val args = runCatching { json.parseToJsonElement(argsJson).jsonObject }.getOrNull() ?: JsonObject(emptyMap())
        val botId = args.string("botId")
        val bot = botId?.let { id -> _uiState.value.snapshot.bots.firstOrNull { it.id == id } }
        when (action) {
            "send" -> {
                val text = args.string("text").orEmpty()
                if (bot != null && text.isNotBlank()) sendMessage(bot, text)
            }
            "stop" -> bot?.let { stopGeneration(it) }
            "newSession" -> bot?.let { startNewSession(it) }
            "reconnect" -> reconnectDesktop()
            "setHarkResumeLast" -> {
                val enabled = args["enabled"]?.jsonPrimitive?.contentOrNull?.toBooleanStrictOrNull() ?: false
                setHarkResumeLast(enabled)
            }
            "openUrl" -> {
                val url = args.string("url")
                if (!url.isNullOrBlank()) {
                    runCatching {
                        getApplication<android.app.Application>().startActivity(
                            android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
                                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                    }
                }
            }
            "selectBot" -> {
                if (botId != null) {
                    _uiState.update { st -> st.copy(snapshot = st.snapshot.copy(selectedBotId = botId)) }
                }
            }
            "selectHarkConversation" -> {
                val sessionId = args.string("sessionId")
                val title = args.string("title")
                val kind = args.string("kind")
                if (botId != null && sessionId != null) {
                    _uiState.update { st ->
                        st.copy(snapshot = st.snapshot.copy(bots = st.snapshot.bots.map { item ->
                            if (item.id == botId) {
                                item.copy(
                                    activeSessionId = sessionId,
                                    activeSessionTitle = title ?: item.activeSessionTitle,
                                    activeSessionKind = kind ?: item.activeSessionKind,
                                    harkProjectsOpen = false
                                )
                            } else item
                        }))
                    }
                }
            }
            "showHarkProjects" -> {
                if (botId != null) {
                    _uiState.update { st ->
                        st.copy(snapshot = st.snapshot.copy(bots = st.snapshot.bots.map { item ->
                            if (item.id == botId) item.copy(harkProjectsOpen = true) else item
                        }))
                    }
                }
            }
            "decideApproval" -> {
                val accountId = args.string("accountId").orEmpty()
                val approvalId = args.string("approvalId").orEmpty()
                val decision = args.string("decision").orEmpty()
                val item = _uiState.value.pendingApprovals.firstOrNull {
                    it.accountId == accountId && it.approval.id == approvalId
                }
                if (item != null && decision.isNotBlank()) decideApproval(item, decision)
            }
        }
    }

    /** Hark RPC used by the shared Hark project page inside the WebView. */
    suspend fun harkBridgeRpc(requestJson: String): String = withContext(Dispatchers.IO) {
        val req = runCatching { json.parseToJsonElement(requestJson).jsonObject }.getOrNull()
            ?: return@withContext bridgeError("无效的 Hark 请求")
        val accountId = req.string("accountId").orEmpty()
        val cred = _uiState.value.harkCredentials.firstOrNull { it.accountId == accountId }
            ?: return@withContext bridgeError("手机没有该 Hark 账号的登录凭据")
        val bot = _uiState.value.snapshot.bots.firstOrNull { it.activeAccountId == accountId }
            ?: _uiState.value.snapshot.bots.firstOrNull { it.id == req.string("botId") }
            ?: return@withContext bridgeError("找不到 Hark 机器人")
        try {
            val op = req.string("op").orEmpty()
            val data: JsonElement = when (op) {
                "listConversations" -> buildJsonObject {
                    val statuses = runCatching { harkDirect.listStatuses(cred) }.getOrDefault(emptyMap())
                    put("conversations", buildJsonArray {
                        harkDirect.listProjects(cred).forEach { project ->
                            add(json.encodeToJsonElement(
                                SyncedHarkProject.serializer(),
                                project.copy(status = statuses[project.id] ?: project.status)
                            ))
                        }
                    })
                }
                "conversationStatus" -> buildJsonObject {
                    put("statuses", buildJsonObject {
                        harkDirect.listStatuses(cred).forEach { (id, value) -> put(id, value) }
                    })
                }
                "conversationMessages" -> {
                    val conversationId = req.string("conversationId").orEmpty()
                    val messages = harkDirect.fetchMessages(cred, conversationId, bot.id, accountId)
                    val status = runCatching { harkDirect.listStatuses(cred)[conversationId] }.getOrNull()
                    buildJsonObject {
                        put("messages", buildJsonArray { messages.forEach { add(harkMessageRow(it)) } })
                        put("loaded", true)
                        put("working", status.equals("working", ignoreCase = true))
                        put("narration", "")
                    }
                }
                "mainConversation" -> {
                    val conversationId = harkDirect.mainConversationId(cred)
                        ?: return@withContext bridgeError("Hark 没有可用的主对话")
                    val messages = harkDirect.fetchMessages(cred, conversationId, bot.id, accountId)
                    buildJsonObject {
                        put("conversationId", conversationId)
                        put("messages", buildJsonArray { messages.forEach { add(harkMessageRow(it)) } })
                    }
                }
                "createProject" -> {
                    val title = req.string("title").orEmpty()
                    val id = harkDirect.createProject(cred, title)
                        ?: return@withContext bridgeError("创建 Hark 项目失败")
                    val now = Instant.now().toString()
                    val createdProject = SyncedHarkProject(
                        id = id,
                        kind = "project",
                        title = title.ifBlank { null },
                        createdAt = now,
                        activityAt = now
                    )
                    _uiState.update { st ->
                        st.copy(snapshot = st.snapshot.copy(bots = st.snapshot.bots.map { item ->
                            if (item.id == bot.id) {
                                item.copy(harkProjects = (item.harkProjects + createdProject).distinctBy { it.id })
                            } else item
                        }))
                    }
                    buildJsonObject {
                        put("conversationId", id)
                        put("title", title)
                    }
                }
                "downloadArtifact" -> {
                    val dataUrl = harkDirect.downloadArtifact(
                        cred = cred,
                        url = req.string("url"),
                        fileId = req.string("fileId"),
                        name = req.string("name")
                    ) ?: return@withContext bridgeError("下载 Hark 图片失败")
                    buildJsonObject {
                        put("dataBase64", dataUrl.substringAfter(',', ""))
                        put("mimeType", dataUrl.substringAfter("data:", "").substringBefore(";", "application/octet-stream"))
                        put("filename", req.string("name") ?: "image")
                    }
                }
                "call" -> {
                    val method = req.string("method").orEmpty().uppercase()
                    val path = req.string("path").orEmpty()
                    if (method == "GET" && path.contains("/billing/summary")) {
                        val data = harkDirect.billingSummary(cred) ?: buildJsonObject {}
                        return@withContext buildJsonObject {
                            put("ok", true)
                            put("data", data)
                        }.toString()
                    }
                    if (path.contains("/connectors/link-sessions")) {
                        val body = req["body"]?.jsonObject
                        val link = harkDirect.linkConnectorSession(
                            cred = cred,
                            provider = body?.string("provider").orEmpty(),
                            returnUrl = body?.string("returnUrl").orEmpty()
                                .ifBlank { "https://app.hark.com/settings/connected-accounts" },
                            origin = body?.string("origin").orEmpty().ifBlank { "chat" }
                        )
                        return@withContext buildJsonObject {
                            put("ok", true)
                            put("data", link ?: buildJsonObject {})
                        }.toString()
                    }
                    val conversationId = req.string("conversationId")
                        ?: path.substringAfter("/conversations/", "").substringBefore("/").takeIf { it.isNotBlank() }
                    when {
                        path.contains("/viewed") && conversationId != null ->
                            harkDirect.markViewed(cred, java.net.URLDecoder.decode(conversationId, "UTF-8"))
                        method == "DELETE" && conversationId != null -> {
                            val deletedId = java.net.URLDecoder.decode(conversationId, "UTF-8")
                            harkDirect.deleteProject(cred, deletedId)
                            _uiState.update { st ->
                                st.copy(snapshot = st.snapshot.copy(bots = st.snapshot.bots.map { item ->
                                    if (item.id == bot.id) {
                                        item.copy(
                                            harkProjects = item.harkProjects.filter { project -> project.id != deletedId },
                                            activeSessionId = if (item.activeSessionId == deletedId) null else item.activeSessionId,
                                            harkProjectsOpen = if (item.activeSessionId == deletedId) true else item.harkProjectsOpen
                                        )
                                    } else item
                                }))
                            }
                        }
                        path.contains("pause-agent") ->
                            harkDirect.pauseAgent(cred, conversationId ?: bot.activeSessionId.orEmpty())
                        else -> Unit
                    }
                    buildJsonObject { put("ok", true) }
                }
                "watchConversation" -> {
                    val conversationId = req.string("conversationId").orEmpty()
                    if (conversationId.isNotBlank()) startHarkWatch(bot, accountId, conversationId)
                    buildJsonObject { put("ok", true) }
                }
                "unwatchConversation" -> {
                    val conversationId = req.string("conversationId").orEmpty()
                    if (conversationId.isNotBlank()) stopHarkWatch(accountId, conversationId)
                    buildJsonObject { put("ok", true) }
                }
                "cancelReply" -> {
                    req.string("conversationId")?.takeIf { it.isNotBlank() }?.let { stopHarkWatch(accountId, it) }
                    buildJsonObject { put("ok", true) }
                }
                else -> return@withContext bridgeError("不支持的 Hark 操作：$op")
            }
            buildJsonObject {
                put("ok", true)
                put("data", data)
            }.toString()
        } catch (error: Exception) {
            bridgeError(error.message ?: "Hark 请求失败")
        }
    }

    /** Keep the project list and chat header live while the user watches one Hark project. */
    private fun startHarkWatch(bot: SyncedBot, accountId: String, conversationId: String) {
        val key = "$accountId:$conversationId"
        harkWatchJobs[key]?.cancel()
        harkWatchJobs[key] = viewModelScope.launch {
            while (true) {
                val cred = _uiState.value.harkCredentials.firstOrNull { it.accountId == accountId }
                if (cred == null) break
                val statuses = runCatching { harkDirect.listStatuses(cred) }.getOrDefault(emptyMap())
                val anyWorking = statuses.values.any { it.equals("working", ignoreCase = true) }
                _uiState.update { st ->
                    val bots = st.snapshot.bots.map { item ->
                        if (item.id == bot.id) {
                            item.copy(
                                activityBusy = anyWorking,
                                harkProjects = item.harkProjects.map { project ->
                                    project.copy(status = statuses[project.id] ?: project.status)
                                }
                            )
                        } else item
                    }
                    val typing = st.typingByBotId.toMutableMap()
                    if (anyWorking) typing[bot.id] = true else typing.remove(bot.id)
                    st.copy(snapshot = st.snapshot.copy(bots = bots), typingByBotId = typing)
                }
                delay(3_000)
            }
        }
    }

    private fun stopHarkWatch(accountId: String, conversationId: String) {
        harkWatchJobs.remove("$accountId:$conversationId")?.cancel()
    }

    private fun harkMessageRow(message: SyncedMessage): JsonObject = buildJsonObject {
        put("id", message.id)
        put("role", if (message.isUser) "user" else "assistant")
        put("content", message.text)
        put("createdAt", message.createdAt)
        message.tools?.takeIf { it.isNotEmpty() }?.let { tools ->
            put("toolCalls", buildJsonArray {
                tools.forEach { tool ->
                    add(buildJsonObject {
                        put("dispatchId", tool.id)
                        put("name", tool.name)
                        put("status", tool.status)
                        tool.summary?.let { put("result", it) }
                    })
                }
            })
        }
        message.media?.takeIf { it.isNotEmpty() }?.let { media ->
            put("media", buildJsonArray {
                media.forEach { part ->
                    add(buildJsonObject {
                        put("kind", part.kind)
                        put("path", part.path)
                        part.name?.let { put("name", it) }
                        part.mimeType?.let { put("mimeType", it) }
                    })
                }
            })
        }
    }

    private fun bridgeError(message: String): String =
        buildJsonObject {
            put("ok", false)
            put("message", message)
        }.toString()

    private fun JsonObject.string(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull

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
                val mergedSnap = mergeWithLocalStandalone(_uiState.value.snapshot, sanitizeSnapshotForBridge(snap))
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

    private fun mergeHarkCreds(incoming: List<HarkCredential>): List<HarkCredential> {
        if (incoming.isEmpty()) return _uiState.value.harkCredentials
        val map = _uiState.value.harkCredentials.associateBy { it.accountId }.toMutableMap()
        incoming.forEach { map[it.accountId] = it }
        val merged = map.values.toList()
        vault.saveHarkCredentials(merged)
        return merged
    }

    private fun sanitizeMessageForBridge(message: SyncedMessage): SyncedMessage {
        val media = message.media?.filterNot { it.path.startsWith("data:", ignoreCase = true) } ?: return message
        return if (media.size == message.media?.size) message else message.copy(media = media)
    }

    private fun appendOrUpdateMessage(botId: String, incoming: SyncedMessage) {
        val msg = sanitizeMessageForBridge(incoming)
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
        stopHarkPollers()
        bridge.disconnectWebSocket()
        super.onCleared()
    }
}
