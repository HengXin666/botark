package com.qybaihe.botark.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.FileDownload
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qybaihe.botark.model.PlatformId
import com.qybaihe.botark.ui.components.PlatformIcon
import com.qybaihe.botark.ui.theme.ArkColors
import com.qybaihe.botark.ui.theme.ArkMonoFamily
import com.qybaihe.botark.ui.theme.ArkSansFamily
import com.qybaihe.botark.ui.theme.LivingPulseDot
import com.qybaihe.botark.viewmodel.BotArkUiState

@Composable
fun SyncSettingsScreen(
    state: BotArkUiState,
    onOpenScanner: () -> Unit,
    onReconnect: () -> Unit,
    onUnpair: () -> Unit,
    onOpenAddHermes: () -> Unit,
    onImportBundle: (ByteArray, String) -> Result<Int>,
    onWipeAll: () -> Unit,
    onFetchSubscription: (String) -> Unit = {},
    subscriptionSummary: String = "",
    onStartVpn: () -> Unit = {},
    onStopVpn: () -> Unit = {}
) {
    val palette = ArkColors.current
    val context = LocalContext.current

    var pendingBundleBytes by remember { mutableStateOf<ByteArray?>(null) }
    var transferKey by remember { mutableStateOf("") }
    var importNotice by remember { mutableStateOf<String?>(null) }
    var importError by remember { mutableStateOf<String?>(null) }
    var showWipeConfirm by remember { mutableStateOf(false) }

    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        importNotice = null
        importError = null
        runCatching {
            context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
        }.onSuccess { bytes ->
            if (bytes != null) {
                pendingBundleBytes = bytes
                transferKey = ""
            }
        }.onFailure {
            importError = it.message
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.canvas)
    ) {
        // Editorial Header
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 12.dp)
        ) {
            Text(
                text = "同步",
                fontSize = 19.sp,
                fontFamily = ArkSansFamily,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.4).sp,
                color = palette.textPrimary
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = "ZERO-SERVER",
                fontSize = 10.sp,
                fontFamily = ArkMonoFamily,
                color = palette.textSecondary,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(palette.surface)
                    .border(0.8.dp, palette.hairline, CircleShape)
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            )
        }

        Column(
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 18.dp, end = 18.dp, top = 2.dp, bottom = 92.dp)
        ) {
            // Signature Obsidian Hardware Bridge Hero Card
            val heroShape = RoundedCornerShape(20.dp)
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .shadow(14.dp, heroShape, ambientColor = Color.Black.copy(alpha = 0.22f))
                    .clip(heroShape)
                    .background(palette.obsidian)
                    .background(
                        Brush.radialGradient(
                            colors = listOf(
                                palette.prismBlue.copy(alpha = 0.28f),
                                palette.prismViolet.copy(alpha = 0.11f),
                                Color.Transparent
                            ),
                            center = Offset(860f, 30f),
                            radius = 520f
                        )
                    )
                    .border(0.8.dp, Color.White.copy(alpha = 0.09f), heroShape)
                    .padding(16.dp)
            ) {
                val desktop = state.pairedDesktop
                if (desktop != null) {
                    val online = state.connectionState.isBridgeConnected
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
                            Column(verticalArrangement = Arrangement.spacedBy(3.dp), modifier = Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                    LivingPulseDot(
                                        color = if (online) palette.emerald else Color.Gray,
                                        size = 6.5.dp,
                                        animated = online
                                    )
                                    Text(
                                        text = if (online) "LIVE BRIDGE" else "OFFLINE",
                                        fontSize = 10.sp,
                                        fontFamily = ArkMonoFamily,
                                        color = if (online) palette.emerald else Color.White.copy(alpha = 0.55f)
                                    )
                                }
                                Text(
                                    text = desktop.hostName,
                                    fontSize = 17.sp,
                                    fontFamily = ArkSansFamily,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White,
                                    modifier = Modifier.padding(top = 2.dp)
                                )
                                Text(
                                    text = "${desktop.activeHost}:${desktop.port} · ${desktop.fingerprint}",
                                    fontSize = 11.sp,
                                    fontFamily = ArkMonoFamily,
                                    color = Color.White.copy(alpha = 0.62f),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }

                            Text(
                                text = "${state.snapshot.bots.size} BOTS",
                                fontSize = 10.sp,
                                fontFamily = ArkMonoFamily,
                                color = Color.White.copy(alpha = 0.78f),
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .background(Color.White.copy(alpha = 0.10f))
                                    .padding(horizontal = 8.dp, vertical = 4.dp)
                            )
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            Row(
                                horizontalArrangement = Arrangement.Center,
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .weight(1f)
                                    .height(36.dp)
                                    .clip(CircleShape)
                                    .background(Color.White.copy(alpha = 0.11f))
                                    .clickable(onClick = onReconnect)
                            ) {
                                Icon(Icons.Rounded.Refresh, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
                                Spacer(Modifier.width(5.dp))
                                Text("重连", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                            }

                            Row(
                                horizontalArrangement = Arrangement.Center,
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .weight(1f)
                                    .height(36.dp)
                                    .clip(CircleShape)
                                    .background(palette.porcelain)
                                    .clickable(onClick = onOpenScanner)
                            ) {
                                Icon(Icons.Rounded.QrCodeScanner, contentDescription = null, tint = palette.obsidian, modifier = Modifier.size(14.dp))
                                Spacer(Modifier.width(5.dp))
                                Text("重新扫码", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = palette.obsidian)
                            }

                            Box(
                                contentAlignment = Alignment.Center,
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(palette.rose.copy(alpha = 0.20f))
                                    .clickable(onClick = onUnpair)
                            ) {
                                Icon(Icons.Rounded.Close, contentDescription = "解绑", tint = Color(0xFFFF8080), modifier = Modifier.size(15.dp))
                            }
                        }
                    }
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp), modifier = Modifier.weight(1f)) {
                            Text("未配对电脑端", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White)
                            Text("LAN · Hotspot · Tailscale", fontSize = 11.sp, fontFamily = ArkMonoFamily, color = Color.White.copy(alpha = 0.6f))
                        }
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(5.dp),
                            modifier = Modifier
                                .clip(CircleShape)
                                .background(palette.porcelain)
                                .clickable(onClick = onOpenScanner)
                                .padding(horizontal = 14.dp, vertical = 8.dp)
                        ) {
                            Icon(Icons.Rounded.QrCodeScanner, contentDescription = null, tint = palette.obsidian, modifier = Modifier.size(14.dp))
                            Text("扫码", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = palette.obsidian)
                        }
                    }
                }
            }

            SubscriptionSection(onFetchSubscription, subscriptionSummary, state.vpnRunning, state.vpnNodeCount, state.vpnMessage, onStartVpn, onStopVpn)

            // Section 2: Offline Encrypted Bundle
            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                SectionTitle("离线同步包")
                val cardShape = RoundedCornerShape(17.dp)
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .shadow(5.dp, cardShape, ambientColor = Color.Black.copy(alpha = 0.05f))
                        .clip(cardShape)
                        .background(palette.surface)
                        .border(0.8.dp, palette.hairline, cardShape)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { filePicker.launch(arrayOf("*/*")) }
                            .padding(horizontal = 13.dp, vertical = 11.dp)
                    ) {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .size(30.dp)
                                .clip(RoundedCornerShape(9.dp))
                                .background(palette.subtleFill)
                        ) {
                            Icon(Icons.Rounded.FileDownload, contentDescription = null, tint = palette.textPrimary, modifier = Modifier.size(16.dp))
                        }
                        Spacer(Modifier.width(10.dp))
                        Text("导入 .botark-sync 加密包", fontSize = 13.5.sp, fontWeight = FontWeight.Medium, color = palette.textPrimary)
                        Spacer(Modifier.weight(1f))
                        Text("离线文件", fontSize = 10.5.sp, fontFamily = ArkMonoFamily, color = palette.textSecondary)
                        Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = null, tint = palette.textTertiary, modifier = Modifier.size(16.dp))
                    }
                    if (importNotice != null) {
                        HorizontalDivider(thickness = 0.6.dp, color = palette.hairline)
                        Text(importNotice!!, fontSize = 12.sp, color = palette.emerald, modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp))
                    }
                    if (importError != null) {
                        HorizontalDivider(thickness = 0.6.dp, color = palette.hairline)
                        Text(importError!!, fontSize = 12.sp, color = palette.rose, modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp))
                    }
                }
            }

            // Section 3: Hermes Direct Keystore
            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                SectionTitle("Hermes 脱机直连")
                val cardShape = RoundedCornerShape(17.dp)
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .shadow(5.dp, cardShape, ambientColor = Color.Black.copy(alpha = 0.05f))
                        .clip(cardShape)
                        .background(palette.surface)
                        .border(0.8.dp, palette.hairline, cardShape)
                ) {
                    state.directHermesCredentials.forEach { cred ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 13.dp, vertical = 11.dp)
                        ) {
                            PlatformIcon(PlatformId.HERMES, size = 24.dp)
                            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(
                                    text = cred.botName ?: cred.displayName ?: "Hermes",
                                    fontSize = 13.5.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = palette.textPrimary
                                )
                                Text(
                                    text = cred.baseUrl,
                                    fontSize = 10.5.sp,
                                    fontFamily = ArkMonoFamily,
                                    color = palette.textSecondary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                            Text(
                                text = "Keystore",
                                fontSize = 10.sp,
                                fontFamily = ArkMonoFamily,
                                color = palette.emerald,
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .background(palette.emerald.copy(alpha = 0.11f))
                                    .padding(horizontal = 8.dp, vertical = 3.5.dp)
                            )
                        }
                        HorizontalDivider(thickness = 0.6.dp, color = palette.hairline, modifier = Modifier.padding(start = 47.dp))
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(onClick = onOpenAddHermes)
                            .padding(horizontal = 13.dp, vertical = 11.dp)
                    ) {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .size(24.dp)
                                .clip(CircleShape)
                                .background(palette.ink)
                        ) {
                            Icon(Icons.Rounded.Add, contentDescription = null, tint = palette.onInk, modifier = Modifier.size(14.dp))
                        }
                        Text("添加独立 Hermes 服务器", fontSize = 13.5.sp, fontWeight = FontWeight.Medium, color = palette.textPrimary)
                    }
                }
            }

            // Wipe + minimal mono footer
            val wipeShape = RoundedCornerShape(15.dp)
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(wipeShape)
                    .background(palette.surface)
                    .border(0.8.dp, palette.hairline, wipeShape)
                    .clickable { showWipeConfirm = true }
                    .padding(vertical = 11.dp)
            ) {
                Text("清空本机缓存与密钥", fontSize = 12.5.sp, fontWeight = FontWeight.Medium, color = palette.rose)
            }

            Text(
                text = "AES-256-GCM · Keystore · No Cloud Relay",
                fontSize = 10.sp,
                fontFamily = ArkMonoFamily,
                color = palette.textTertiary,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }

    if (pendingBundleBytes != null) {
        AlertDialog(
            onDismissRequest = { pendingBundleBytes = null },
            title = { Text("输入传输密钥", fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                OutlinedTextField(
                    value = transferKey,
                    onValueChange = { transferKey = it },
                    placeholder = { Text("粘贴电脑端显示的密钥", fontSize = 13.sp) },
                    singleLine = true
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val bytes = pendingBundleBytes!!
                    onImportBundle(bytes, transferKey).onSuccess { count ->
                        importNotice = "已导入 $count 个智能体"
                        importError = null
                    }.onFailure {
                        importError = "密钥错误或文件损坏"
                    }
                    pendingBundleBytes = null
                }) { Text("解密导入") }
            },
            dismissButton = {
                TextButton(onClick = { pendingBundleBytes = null }) { Text("取消") }
            }
        )
    }

    if (showWipeConfirm) {
        AlertDialog(
            onDismissRequest = { showWipeConfirm = false },
            title = { Text("清空本机同步缓存与密钥？", fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
            confirmButton = {
                TextButton(onClick = {
                    showWipeConfirm = false
                    onWipeAll()
                }) { Text("清空", color = palette.rose) }
            },
            dismissButton = {
                TextButton(onClick = { showWipeConfirm = false }) { Text("取消") }
            }
        )
    }
}

@Composable
private fun SectionTitle(text: String) {
    val palette = ArkColors.current
    Text(
        text = text,
        fontSize = 11.5.sp,
        fontWeight = FontWeight.SemiBold,
        color = palette.textSecondary,
        modifier = Modifier.padding(horizontal = 2.dp)
    )
}

@Composable
private fun SubscriptionSection(
    onFetch: (String) -> Unit,
    summary: String,
    vpnRunning: Boolean,
    vpnNodeCount: Int,
    vpnMessage: String,
    onStartVpn: () -> Unit,
    onStopVpn: () -> Unit
) {
    var url by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        SectionTitle("远程订阅")
        val cardShape = RoundedCornerShape(17.dp)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(5.dp, cardShape, ambientColor = Color.Black.copy(alpha = 0.05f))
                .clip(cardShape)
                .border(0.8.dp, ArkColors.current.hairline, cardShape)
                .background(ArkColors.current.surface)
                .padding(13.dp)
        ) {
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                placeholder = { Text("https://example.com/sub?token=...", fontSize = 12.sp) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(7.dp))
            Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                TextButton(onClick = { onFetch(url.trim()) }, enabled = url.isNotBlank()) {
                    Text("拉取订阅", fontSize = 12.5.sp)
                }
            }
            if (summary.isNotBlank()) {
                Text(summary, fontSize = 11.sp, color = ArkColors.current.textSecondary)
            }
            Text(
                "支持 HTTP/SOCKS5 URI 列表、base64 订阅、Clash YAML；扫码同步会携带电脑端可用节点（本地代理走加密局域网中继），开启时自动优先未使用的可用节点，并由系统 VPN 接管流量。",
                fontSize = 10.sp,
                color = ArkColors.current.textTertiary
            )
            Spacer(Modifier.height(9.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    if (vpnRunning) "代理运行中 · " + vpnNodeCount + " 个节点" else (vpnMessage.ifBlank { "代理未开启" }),
                    fontSize = 11.5.sp,
                    color = ArkColors.current.textSecondary
                )
                Spacer(Modifier.weight(1f))
                if (vpnRunning) {
                    TextButton(onClick = onStopVpn) { Text("停止代理", fontSize = 12.5.sp) }
                } else {
                    TextButton(onClick = onStartVpn, enabled = vpnNodeCount > 0 || true) { Text("开启代理", fontSize = 12.5.sp) }
                }
            }
        }
    }
}