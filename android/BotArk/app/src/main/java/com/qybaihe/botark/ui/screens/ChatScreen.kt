package com.qybaihe.botark.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.EditNote
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.Terminal
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qybaihe.botark.model.ConnectionStatus
import com.qybaihe.botark.model.PlatformId
import com.qybaihe.botark.model.PendingApprovalItem
import com.qybaihe.botark.model.SyncedBot
import com.qybaihe.botark.model.SyncedMessage
import com.qybaihe.botark.model.SyncedToolCall
import com.qybaihe.botark.ui.components.BotAvatar
import com.qybaihe.botark.ui.components.PlatformBadgePill
import com.qybaihe.botark.ui.components.PlatformIcon
import com.qybaihe.botark.ui.components.decodeBase64Image
import com.qybaihe.botark.ui.theme.ArkColors
import com.qybaihe.botark.ui.theme.ArkMonoFamily
import com.qybaihe.botark.ui.theme.ArkSansFamily
import com.qybaihe.botark.ui.theme.LivingPulseDot
import com.qybaihe.botark.ui.theme.dotColor
import com.qybaihe.botark.viewmodel.BotArkUiState

@Composable
fun ChatScreen(
    state: BotArkUiState,
    botId: String,
    onBack: () -> Unit,
    onOpenProjects: (() -> Unit)? = null,
    onSend: (SyncedBot, String) -> Unit,
    onStop: (SyncedBot) -> Unit,
    onNewSession: (SyncedBot) -> Unit,
    onDecideApproval: (PendingApprovalItem, String) -> Unit
) {
    val palette = ArkColors.current
    val bot = state.snapshot.bots.firstOrNull { it.id == botId }
    if (bot == null) {
        Box(Modifier.fillMaxSize().background(palette.canvas), contentAlignment = Alignment.Center) {
            Text("智能体已移除", fontSize = 14.sp, color = palette.textSecondary)
        }
        return
    }

    val messages = state.snapshot.messages[botId].orEmpty()
    val botApprovals = state.pendingApprovals.filter { it.accountId == bot.activeAccountId }
    val isTyping = state.typingByBotId[bot.id] == true
    val canSend = state.canSend(bot)
    val botStatus = state.status(bot)
    val harkProject = bot.harkProjects.firstOrNull { it.id == bot.activeSessionId }
    val harkCompleted = bot.platformId == PlatformId.HARK &&
        bot.activeSessionId != null &&
        !isTyping &&
        !bot.activityBusy &&
        harkProject?.status?.equals("working", ignoreCase = true) != true &&
        harkProject?.let { harkHasHistory(it) } == true
    var draft by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(messages.size, messages.lastOrNull()?.text, isTyping) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.lastIndex)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.canvas)
            .imePadding()
    ) {
        // Minimal Studio Header
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 9.dp)
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(palette.surface)
                    .border(0.8.dp, palette.hairline, CircleShape)
                    .clickable(onClick = onBack)
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Rounded.KeyboardArrowLeft,
                    contentDescription = "返回",
                    tint = palette.textPrimary,
                    modifier = Modifier.size(20.dp)
                )
            }
            Spacer(Modifier.width(10.dp))
            PlatformIcon(platform = bot.platformId, size = 22.dp)
            Spacer(Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = bot.name,
                    fontSize = 14.5.sp,
                    fontFamily = ArkSansFamily,
                    fontWeight = FontWeight.SemiBold,
                    color = palette.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(3.dp)
                ) {
                    if (harkCompleted) {
                        Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = palette.emerald, modifier = Modifier.size(11.dp))
                        Text("已完成", fontSize = 10.5.sp, color = palette.emerald)
                        Spacer(Modifier.width(3.dp))
                    }
                    LivingPulseDot(
                        color = botStatus.dotColor(),
                        size = 5.5.dp,
                        animated = botStatus == ConnectionStatus.ONLINE || botStatus == ConnectionStatus.BUSY || botStatus == ConnectionStatus.ATTENTION
                    )
                    Text(
                        text = state.shortTransportLabel(bot),
                        fontSize = 10.5.sp,
                        color = palette.textSecondary
                    )
                }
            }
            if (onOpenProjects != null) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.size(34.dp).clip(CircleShape).background(palette.surface).border(0.8.dp, palette.hairline, CircleShape).clickable(onClick = onOpenProjects)
                ) {
                    Icon(Icons.Rounded.FolderOpen, contentDescription = "项目", tint = palette.textPrimary, modifier = Modifier.size(18.dp))
                }
            }
            if (bot.platformId.supportsQuickNewSession) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(34.dp)
                        .clip(CircleShape)
                        .background(palette.surface)
                        .border(0.8.dp, palette.hairline, CircleShape)
                        .clickable(enabled = canSend) { onNewSession(bot) }
                ) {
                    Icon(
                        imageVector = Icons.Rounded.EditNote,
                        contentDescription = "新对话",
                        tint = if (canSend) palette.textPrimary else palette.textTertiary,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }

        // Floating editorial approval card(s)
        if (botApprovals.isNotEmpty()) {
            Column(
                verticalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp)
            ) {
                botApprovals.forEach { item ->
                    InlineApprovalCard(item = item, onDecide = { onDecideApproval(item, it) })
                }
            }
        }

        // Messages canvas
        LazyColumn(
            state = listState,
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.weight(1f)
        ) {
            if (messages.isEmpty()) {
                item {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 72.dp)
                    ) {
                        BotAvatar(bot = bot, status = botStatus, size = 52.dp)
                        Text(bot.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = palette.textPrimary)
                        PlatformBadgePill(bot.platformId)
                    }
                }
            } else {
                items(messages, key = { it.id }) { msg ->
                    MessageBubbleRow(message = msg)
                }
            }

            if (isTyping) {
                item(key = "typing") {
                    Text(
                        text = "正在生成...",
                        fontSize = 12.sp,
                        color = palette.textSecondary,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(palette.surface)
                            .border(0.8.dp, palette.hairline, CircleShape)
                            .padding(horizontal = 12.dp, vertical = 8.dp)
                    )
                }
            }
        }

        // Floating Tactile Capsule Composer (no clunky bottom bar!)
        val composerShape = RoundedCornerShape(24.dp)
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp)
                .shadow(8.dp, composerShape, ambientColor = Color.Black.copy(alpha = 0.06f))
                .clip(composerShape)
                .background(palette.surface)
                .border(0.9.dp, palette.hairline, composerShape)
                .padding(start = 15.dp, end = 5.dp, top = 5.dp, bottom = 5.dp)
        ) {
            Box(
                contentAlignment = Alignment.CenterStart,
                modifier = Modifier
                    .weight(1f)
                    .padding(vertical = 7.dp)
            ) {
                if (draft.isEmpty()) {
                    Text(
                        text = if (canSend) "给 ${bot.name} 发消息..." else "离线只读",
                        fontSize = 14.sp,
                        color = palette.textTertiary
                    )
                }
                BasicTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    enabled = canSend,
                    maxLines = 5,
                    textStyle = TextStyle(
                        fontSize = 14.sp,
                        fontFamily = ArkSansFamily,
                        color = palette.textPrimary,
                        lineHeight = 19.sp
                    ),
                    cursorBrush = SolidColor(palette.ink),
                    modifier = Modifier.fillMaxWidth()
                )
            }

            if (isTyping) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(34.dp)
                        .clip(CircleShape)
                        .background(palette.rose)
                        .clickable { onStop(bot) }
                ) {
                    Icon(Icons.Rounded.Stop, contentDescription = "停止", tint = Color.White, modifier = Modifier.size(15.dp))
                }
            } else {
                val ready = canSend && draft.trim().isNotEmpty()
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(34.dp)
                        .clip(CircleShape)
                        .background(if (ready) palette.ink else palette.subtleFill)
                        .clickable(enabled = ready) {
                            val t = draft.trim()
                            draft = ""
                            onSend(bot, t)
                        }
                ) {
                    Icon(
                        imageVector = Icons.Rounded.ArrowUpward,
                        contentDescription = "发送",
                        tint = if (ready) palette.onInk else palette.textTertiary,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun MessageBubbleRow(message: SyncedMessage) {
    val palette = ArkColors.current
    Row(
        horizontalArrangement = if (message.isUser) Arrangement.End else Arrangement.Start,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            horizontalAlignment = if (message.isUser) Alignment.End else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.widthIn(max = 314.dp)
        ) {
            if (!message.tools.isNullOrEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    message.tools.forEach { ToolCallPill(it) }
                }
            }

            if (!message.media.isNullOrEmpty()) {
                message.media.forEach { part ->
                    if (part.kind == "image") {
                        val bmp = remember(part.path) { decodeBase64Image(part.path) }
                        if (bmp != null) {
                            Image(
                                bitmap = bmp,
                                contentDescription = part.name,
                                contentScale = ContentScale.Fit,
                                modifier = Modifier
                                    .widthIn(max = 225.dp)
                                    .clip(RoundedCornerShape(14.dp))
                            )
                        }
                    }
                }
            }

            if (message.text.isNotEmpty()) {
                val bubbleShape = RoundedCornerShape(
                    topStart = 18.dp,
                    topEnd = 18.dp,
                    bottomStart = if (message.isUser) 18.dp else 6.dp,
                    bottomEnd = if (message.isUser) 6.dp else 18.dp
                )
                val formatted = remember(message.text) { renderInlineBold(message.text) }
                Text(
                    text = formatted,
                    fontSize = 13.8.sp,
                    fontFamily = ArkSansFamily,
                    lineHeight = 20.5.sp,
                    color = if (message.isUser) palette.onInk else palette.textPrimary,
                    modifier = Modifier
                        .shadow(4.dp, bubbleShape, ambientColor = Color.Black.copy(alpha = 0.06f))
                        .clip(bubbleShape)
                        .background(if (message.isUser) palette.ink else palette.surface)
                        .then(
                            if (message.isUser) Modifier else Modifier.border(0.8.dp, palette.hairline, bubbleShape)
                        )
                        .padding(horizontal = 13.dp, vertical = 10.dp)
                )
            }

            if (!message.error.isNullOrEmpty()) {
                Text(text = message.error, fontSize = 11.sp, color = palette.rose)
            } else if (message.isUser && message.delivery == "sending") {
                Text("发送中", fontSize = 10.sp, fontFamily = ArkMonoFamily, color = palette.textTertiary)
            }
        }
    }
}

private fun renderInlineBold(raw: String): AnnotatedString = buildAnnotatedString {
    val parts = raw.split("**")
    parts.forEachIndexed { index, part ->
        if (index % 2 == 1) {
            withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(part) }
        } else {
            append(part)
        }
    }
}

@Composable
private fun ToolCallPill(tool: SyncedToolCall) {
    val palette = ArkColors.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        modifier = Modifier
            .clip(CircleShape)
            .background(palette.surface)
            .border(0.8.dp, palette.hairline, CircleShape)
            .padding(horizontal = 9.dp, vertical = 4.5.dp)
    ) {
        when (tool.status) {
            "running" -> CircularProgressIndicator(
                strokeWidth = 1.6.dp,
                color = palette.accent,
                modifier = Modifier.size(11.dp)
            )
            "completed" -> Icon(
                Icons.Rounded.CheckCircle,
                contentDescription = null,
                tint = palette.emerald,
                modifier = Modifier.size(12.dp)
            )
            "errored", "failed" -> Icon(
                Icons.Rounded.Close,
                contentDescription = null,
                tint = palette.rose,
                modifier = Modifier.size(12.dp)
            )
            else -> Icon(
                Icons.Rounded.Terminal,
                contentDescription = null,
                tint = palette.textSecondary,
                modifier = Modifier.size(11.dp)
            )
        }
        Text(
            text = tool.name,
            fontSize = 10.5.sp,
            fontFamily = ArkMonoFamily,
            color = palette.textPrimary
        )
        if (!tool.summary.isNullOrBlank()) {
            Text(
                text = tool.summary,
                fontSize = 11.sp,
                color = palette.textSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun InlineApprovalCard(
    item: PendingApprovalItem,
    onDecide: (String) -> Unit
) {
    val palette = ArkColors.current
    val shape = RoundedCornerShape(16.dp)

    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .shadow(6.dp, shape, ambientColor = palette.amber.copy(alpha = 0.14f))
            .clip(shape)
            .background(palette.surface)
            .border(1.dp, palette.amber.copy(alpha = 0.45f), shape)
            .padding(12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Rounded.Shield, contentDescription = null, tint = palette.amber, modifier = Modifier.size(14.dp))
            Text(
                text = item.approval.title,
                fontSize = 12.5.sp,
                fontFamily = ArkSansFamily,
                fontWeight = FontWeight.SemiBold,
                color = palette.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        if (!item.approval.detail.isNullOrBlank()) {
            Text(
                text = item.approval.detail,
                fontSize = 10.5.sp,
                lineHeight = 15.sp,
                fontFamily = ArkMonoFamily,
                color = palette.textSecondary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(7.dp), modifier = Modifier.fillMaxWidth()) {
            ApprovalActionPill("允许", palette.ink, palette.onInk) { onDecide("allow_once") }
            ApprovalActionPill("本次会话", palette.subtleFill, palette.textPrimary) { onDecide("allow_session") }
            Spacer(Modifier.weight(1f))
            ApprovalActionPill("拒绝", palette.rose.copy(alpha = 0.10f), palette.rose) { onDecide("deny") }
        }
    }
}

@Composable
fun ApprovalActionPill(label: String, fill: Color, fg: Color, onClick: () -> Unit) {
    Text(
        text = label,
        fontSize = 11.5.sp,
        fontFamily = ArkSansFamily,
        fontWeight = FontWeight.SemiBold,
        color = fg,
        modifier = Modifier
            .clip(CircleShape)
            .background(fill)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 5.5.dp)
    )
}
