package com.qybaihe.botark.ui.components

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qybaihe.botark.R
import com.qybaihe.botark.model.ConnectionStatus
import com.qybaihe.botark.model.PlatformId
import com.qybaihe.botark.model.SyncedBot
import com.qybaihe.botark.ui.theme.ArkColors
import com.qybaihe.botark.ui.theme.ArkSansFamily
import com.qybaihe.botark.ui.theme.brandColor
import com.qybaihe.botark.ui.theme.dotColor

fun PlatformId.drawableRes(): Int = when (this) {
    PlatformId.META_MUSE -> R.drawable.ic_platform_muse
    PlatformId.GROK -> R.drawable.ic_platform_grok
    PlatformId.DOT -> R.drawable.ic_platform_dot
    PlatformId.HARK -> R.drawable.ic_platform_hark
    PlatformId.HERMES -> R.drawable.ic_platform_hermes
    PlatformId.ANTIGRAVITY -> R.drawable.ic_platform_antigravity
}

@Composable
fun PlatformIcon(platform: PlatformId, size: Dp = 18.dp, modifier: Modifier = Modifier) {
    Image(
        painter = painterResource(platform.drawableRes()),
        contentDescription = platform.displayName,
        contentScale = ContentScale.Fit,
        modifier = modifier
            .size(size)
            .clip(RoundedCornerShape(size * 0.26f))
    )
}

@Composable
fun BotAvatar(
    bot: SyncedBot,
    status: ConnectionStatus,
    size: Dp = 40.dp,
    isWorking: Boolean = false
) {
    val palette = ArkColors.current
    val shape = RoundedCornerShape(size * 0.32f)
    val decoded = remember(bot.avatar) { decodeBase64Image(bot.avatar) }
    // The desktop renderer drives the character from isWorking OR a busy status; mirror that
    // here so list rows animate even though BotListScreen does not pass isWorking explicitly.
    val effectiveWorking = isWorking || bot.activityBusy || status == ConnectionStatus.BUSY

    Box(modifier = Modifier.size(size)) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(size)
                .clip(shape)
                .background(
                    Brush.linearGradient(
                        listOf(
                            bot.platformId.brandColor().copy(alpha = 0.14f),
                            bot.platformId.brandColor().copy(alpha = 0.04f)
                        )
                    )
                )
                .border(0.8.dp, palette.hairline, shape)
        ) {
            if (decoded != null) {
                // Custom user photo always wins over the generated character.
                Image(
                    bitmap = decoded,
                    contentDescription = bot.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(size)
                )
            } else {
                // No emoji fallback: desktop never renders emoji, and Hark bots commonly store
                // a placeholder "-" which used to appear as a stray dash in an empty tile.
                BotMark(
                    seed = bot.id,
                    shape = bot.avatarShape,
                    color = bot.avatarColor,
                    status = status,
                    isWorking = effectiveWorking,
                    size = size
                )
            }
        }

        val dotSize = (size * 0.22f).coerceAtLeast(8.5.dp)
        BotStatusDot(
            status = status,
            dotSize = dotSize,
            ringColor = palette.surface,
            pulsing = effectiveWorking,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .offset(x = 1.5.dp, y = 1.5.dp)
        )
    }
}

@Composable
private fun BotStatusDot(
    status: ConnectionStatus,
    dotSize: Dp,
    ringColor: Color,
    pulsing: Boolean,
    modifier: Modifier = Modifier
) {
    Box(modifier = modifier.size(dotSize), contentAlignment = Alignment.Center) {
        if (pulsing) {
            val transition = rememberInfiniteTransition(label = "botStatusPulse")
            val pulseScale by transition.animateFloat(
                initialValue = 1f,
                targetValue = 1.9f,
                animationSpec = infiniteRepeatable(
                    animation = tween(durationMillis = 1400, easing = FastOutSlowInEasing),
                    repeatMode = RepeatMode.Restart
                ),
                label = "botStatusPulseScale"
            )
            val pulseAlpha by transition.animateFloat(
                initialValue = 0.42f,
                targetValue = 0f,
                animationSpec = infiniteRepeatable(
                    animation = tween(durationMillis = 1400, easing = FastOutSlowInEasing),
                    repeatMode = RepeatMode.Restart
                ),
                label = "botStatusPulseAlpha"
            )
            Box(
                modifier = Modifier
                    .size(dotSize)
                    .scale(pulseScale)
                    .clip(CircleShape)
                    .background(status.dotColor().copy(alpha = pulseAlpha))
            )
        }
        Box(
            modifier = Modifier
                .size(dotSize)
                .clip(CircleShape)
                .background(status.dotColor())
                .border(1.8.dp, ringColor, CircleShape)
        )
    }
}

@Composable
fun PlatformBadgePill(platform: PlatformId) {
    val brand = platform.brandColor()
    Text(
        text = platform.shortLabel,
        fontSize = 10.sp,
        lineHeight = 13.sp,
        fontFamily = ArkSansFamily,
        fontWeight = FontWeight.SemiBold,
        color = brand,
        maxLines = 1,
        modifier = Modifier
            .clip(CircleShape)
            .background(brand.copy(alpha = 0.10f))
            .padding(horizontal = 6.5.dp, vertical = 2.5.dp)
    )
}

fun decodeBase64Image(raw: String?): ImageBitmap? {
    if (raw.isNullOrBlank()) return null
    val part = raw.substringAfter(",", raw)
    return runCatching {
        val bytes = Base64.decode(part, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
    }.getOrNull()
}
