package com.qybaihe.botark.ui.screens

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qybaihe.botark.model.SyncedBot
import com.qybaihe.botark.model.SyncedHarkProject
import com.qybaihe.botark.ui.components.PlatformIcon
import com.qybaihe.botark.ui.theme.ArkColors
import com.qybaihe.botark.ui.theme.ArkSansFamily
import com.qybaihe.botark.viewmodel.BotArkUiState
import java.time.Duration
import java.time.Instant

@Composable
fun HarkProjectsScreen(
    state: BotArkUiState,
    botId: String,
    onBack: () -> Unit,
    onOpenProject: (SyncedBot, SyncedHarkProject) -> Unit,
    onDeleteProject: (SyncedBot, String) -> Unit,
    onRefresh: (SyncedBot) -> Unit,
    onToggleResume: (Boolean) -> Unit
) {
    val palette = ArkColors.current
    val bot = state.snapshot.bots.firstOrNull { it.id == botId }
    if (bot == null) {
        Box(Modifier.fillMaxSize().background(palette.canvas), contentAlignment = Alignment.Center) {
            Text("智能体已移除", fontSize = 14.sp, color = palette.textSecondary)
        }
        return
    }

    BackHandler { onBack() }

    val projects = bot.harkProjects
    val active = projects.filter { it.kind != "main" && it.archivedAt == null }.sortedByDescending { it.activityAt }
    val main = projects.firstOrNull { it.kind == "main" }
    val working = active.filter { it.status.equals("working", ignoreCase = true) }
    var pendingDelete by remember { mutableStateOf<SyncedHarkProject?>(null) }
    var autoOpenDone by remember(bot.id) { mutableStateOf(false) }

    LaunchedEffect(bot.id) {
        onRefresh(bot)
    }
    LaunchedEffect(bot.id, bot.activeSessionId, state.harkResumeLast, working.map { it.id }) {
        if (autoOpenDone || projects.isEmpty() || projects.none { it.status != null }) return@LaunchedEffect
        autoOpenDone = true
        if (state.harkResumeLast && bot.activeSessionId.isNullOrBlank() && working.size == 1) {
            onOpenProject(bot, working.first())
        }
    }

    Column(Modifier.fillMaxSize().background(palette.canvas)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 9.dp)) {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.size(34.dp).clip(CircleShape).background(palette.surface).border(0.8.dp, palette.hairline, CircleShape).clickable(onClick = onBack)) {
                Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, contentDescription = "返回", tint = palette.textPrimary, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(10.dp))
            PlatformIcon(platform = bot.platformId, size = 22.dp)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text("项目", fontSize = 15.sp, fontFamily = ArkSansFamily, fontWeight = FontWeight.SemiBold, color = palette.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("最近更新的项目排在前面", fontSize = 10.5.sp, color = palette.textSecondary)
            }
            Box(contentAlignment = Alignment.Center, modifier = Modifier.size(34.dp).clip(CircleShape).background(palette.surface).border(0.8.dp, palette.hairline, CircleShape).clickable { onRefresh(bot) }) {
                Icon(Icons.Rounded.Refresh, contentDescription = "刷新项目", tint = palette.textPrimary, modifier = Modifier.size(18.dp))
            }
        }

        LazyColumn(contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.weight(1f)) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(palette.surface).border(0.8.dp, palette.hairline, RoundedCornerShape(16.dp)).padding(horizontal = 14.dp, vertical = 10.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text("打开时恢复上次对话", fontSize = 12.5.sp, fontWeight = FontWeight.Medium, color = palette.textPrimary)
                        Text("默认开启；没有聊过时优先打开正在工作的项目", fontSize = 10.5.sp, color = palette.textSecondary)
                    }
                    Switch(checked = state.harkResumeLast, onCheckedChange = onToggleResume)
                }
            }
            if (working.isNotEmpty()) {
                item { HarkSectionTitle("正在工作", working.size, accent = true) }
                items(working, key = { "working-" + it.id }) { project ->
                    HarkProjectRow(bot, project, true, { onOpenProject(bot, project) }, if (project.kind == "project") ({ pendingDelete = project }) else null)
                }
            }
            if (main != null) {
                item { HarkSectionTitle("主对话", null) }
                item(key = "main-" + main.id) { HarkProjectRow(bot, main, false, { onOpenProject(bot, main) }) }
            }
            item { HarkSectionTitle("项目", active.size) }
            if (active.isEmpty()) {
                item {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp)) {
                        Icon(Icons.Rounded.FolderOpen, contentDescription = null, tint = palette.textTertiary, modifier = Modifier.size(34.dp))
                        Text("还没有项目", fontSize = 13.sp, color = palette.textSecondary)
                        Text("在桌面端新建项目后，这里会自动出现", fontSize = 11.sp, color = palette.textTertiary)
                    }
                }
            } else {
                items(active, key = { it.id }) { project ->
                    HarkProjectRow(bot, project, project.status.equals("working", ignoreCase = true), { onOpenProject(bot, project) }, { pendingDelete = project })
                }
            }
            if (state.lastError != null) {
                item { Text(state.lastError, fontSize = 11.5.sp, color = palette.rose, modifier = Modifier.padding(4.dp)) }
            }
        }
    }

    pendingDelete?.let { project ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("删除项目") },
            text = { Text("确定删除该项目？\n\n会从 Hark 云端删除，无法恢复。") },
            confirmButton = { TextButton(onClick = { pendingDelete = null; onDeleteProject(bot, project.id) }) { Text("删除", color = palette.rose) } },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("取消") } }
        )
    }
}

@Composable
private fun HarkSectionTitle(title: String, count: Int?, accent: Boolean = false) {
    val palette = ArkColors.current
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(horizontal = 2.dp, vertical = 2.dp)) {
        if (accent) {
            Box(Modifier.size(6.dp).clip(CircleShape).background(palette.accent))
            Spacer(Modifier.width(6.dp))
        }
        Text(title, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = if (accent) palette.accent else palette.textSecondary)
        if (count != null) {
            Spacer(Modifier.width(5.dp))
            Text(count.toString(), fontSize = 10.5.sp, color = palette.textTertiary)
        }
        Spacer(Modifier.weight(1f))
    }
}

@Composable
private fun HarkProjectRow(bot: SyncedBot, project: SyncedHarkProject, isWorking: Boolean, onClick: () -> Unit, onDelete: (() -> Unit)? = null) {
    val palette = ArkColors.current
    val title = project.title?.trim().takeUnless { it.isNullOrBlank() } ?: if (project.kind == "main") "主对话" else "未命名项目"
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(palette.surface).border(0.8.dp, palette.hairline, RoundedCornerShape(16.dp)).clickable(onClick = onClick).padding(start = 12.dp, end = 6.dp, top = 10.dp, bottom = 10.dp)) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(34.dp).clip(RoundedCornerShape(11.dp)).background(palette.subtleFill)) {
            Icon(Icons.Rounded.FolderOpen, contentDescription = null, tint = palette.textSecondary, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = palette.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (project.favorite) { Spacer(Modifier.width(4.dp)); Text("★", fontSize = 11.sp, color = palette.amber) }
                if (isWorking) {
                    Spacer(Modifier.width(6.dp)); Box(Modifier.size(6.dp).clip(CircleShape).background(palette.accent)); Spacer(Modifier.width(3.dp)); Text("工作中", fontSize = 10.sp, color = palette.accent)
                } else if (project.status.equals("unread", ignoreCase = true)) {
                    Spacer(Modifier.width(6.dp)); Text("未读", fontSize = 10.sp, color = palette.amber)
                }
            }
            Spacer(Modifier.height(3.dp))
            Text(if (project.kind == "main") "默认会话 · " + formatHarkActivity(project.activityAt) else formatHarkActivity(project.activityAt), fontSize = 10.5.sp, color = palette.textTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (onDelete != null) {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.size(34.dp).clip(CircleShape).clickable(onClick = onDelete)) {
                Icon(Icons.Rounded.DeleteOutline, contentDescription = "删除项目", tint = palette.textTertiary, modifier = Modifier.size(18.dp))
            }
        }
    }
}

private fun formatHarkActivity(value: String): String {
    val instant = runCatching { Instant.parse(value) }.getOrNull() ?: return ""
    val minutes = Duration.between(instant, Instant.now()).toMinutes().coerceAtLeast(0)
    return when {
        minutes < 1 -> "刚刚"
        minutes < 60 -> minutes.toString() + " 分钟前"
        minutes < 24 * 60 -> (minutes / 60).toString() + " 小时前"
        minutes < 7 * 24 * 60 -> (minutes / (24 * 60)).toString() + " 天前"
        else -> value.take(10)
    }
}
