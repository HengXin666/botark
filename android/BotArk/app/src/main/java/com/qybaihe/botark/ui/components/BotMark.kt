package com.qybaihe.botark.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import com.qybaihe.botark.model.ConnectionStatus
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Animated bot character mark for the native Android bot list.
 *
 * This is the Compose counterpart of the desktop renderer's `GrokBotMark`
 * (`src/renderer/src/components/ui/GrokBotMark.tsx` + `grokMotionEngine.js`):
 * the same 26-shape vocabulary, the same colour ids and the same deterministic
 * seed hashing are used to pick a body silhouette and palette, so a given bot
 * looks consistent across desktop and mobile.
 *
 * The desktop mark is a WebGL 3D character; here each shape is approximated by
 * a smooth Canvas path filled with a layered gradient (top light, body colour,
 * bottom shadow), a rim light, a clipped gloss highlight and a soft contact
 * shadow. Eyes are rounded black capsules that blink on a seed-offset cycle.
 * Working bots bob, squash/stretch, rotate and emit orbiting accent dots; idle
 * bots only breathe very gently.
 */

private const val DESIGN_SIZE = 100f
private const val TWO_PI = 6.2831855f

private data class BotColorSpec(
    val id: String,
    val light: Color,
    val dark: Color
)

/**
 * Exact desktop `BOT_COLORS` / Grok `AHe` (`--sand-bg-*-bright`) table.
 */
private val BotColorSpecs: Map<String, BotColorSpec> = listOf(
    BotColorSpec("black", Color(0xFF000000), Color(0xFFFFFFFF)),
    BotColorSpec("brown", Color(0xFFA06B39), Color(0xFFA16B39)),
    BotColorSpec("red", Color(0xFFFB2B3E), Color(0xFFFC2C3E)),
    BotColorSpec("orange", Color(0xFFFD690F), Color(0xFFF9670E)),
    BotColorSpec("yellow", Color(0xFFF59312), Color(0xFFF69412)),
    BotColorSpec("green", Color(0xFF14C16F), Color(0xFF14C370)),
    BotColorSpec("cyan", Color(0xFF13B7A2), Color(0xFF13B8A3)),
    BotColorSpec("blue", Color(0xFF1E86FC), Color(0xFF1884FC)),
    BotColorSpec("violet", Color(0xFF8F59F9), Color(0xFF905AFB)),
    BotColorSpec("magenta", Color(0xFFF93498), Color(0xFFFB3499)),
    BotColorSpec("gray", Color(0xFF959595), Color(0xFF777777))
).associateBy { it.id }

/** Desktop `GROK_DEFAULT_SHAPES` order. */
private val DefaultShapeIds = listOf(
    "blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"
)

/** Desktop `GROK_NON_BLACK_COLORS` order (black is never seed-picked). */
private val DefaultColorIds = listOf(
    "brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray"
)

private val SupportedShapeIds = setOf(
    "blob", "pebble", "bean", "egg", "squircle", "tablet", "capsule", "cylinder",
    "hex", "gem", "crystal", "wedge", "shield", "dome", "arch", "cloud", "teardrop",
    "leaf", "square", "sparkle", "clover", "flower", "heart", "house", "star", "pumpkin"
)

/** Shapes whose face is a single, larger eye (matching the desktop rig's one-eyed bodies). */
private val OneEyeShapes = setOf("capsule", "cylinder", "crystal", "wedge", "teardrop")

@Composable
fun BotMark(
    seed: String,
    shape: String?,
    color: String?,
    status: ConnectionStatus,
    isWorking: Boolean,
    size: Dp,
    modifier: Modifier = Modifier
) {
    val isDark = isSystemInDarkTheme()
    val resolvedShape = remember(seed, shape) { resolveShape(seed, shape) }
    val resolvedColor = remember(seed, shape, color) { resolveColor(seed, color, resolvedShape) }
    val geometry = remember(resolvedShape) { buildGeometry(resolvedShape) }
    val paint = remember(resolvedColor, isDark) {
        buildPaint(BotColorSpecs.getValue(resolvedColor), isDark)
    }
    val blinkOffset = remember(seed) {
        (hashSeed(seed).toLong() and 0xFFFFL).toFloat() / 65536f
    }

    val transition = rememberInfiniteTransition(label = "botMark")
    val motionPhase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 2400, easing = LinearEasing)
        ),
        label = "botMarkMotion"
    )
    val breathPhase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 5600, easing = LinearEasing)
        ),
        label = "botMarkBreath"
    )
    val blinkPhase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 4800, easing = LinearEasing)
        ),
        label = "botMarkBlink"
    )

    val working = isWorking || status == ConnectionStatus.BUSY
    val animated = status != ConnectionStatus.OFFLINE
    val sizePx = with(LocalDensity.current) { size.toPx() }

    Canvas(
        modifier = modifier
            .size(size)
            .graphicsLayer {
                val phase = if (working) motionPhase else breathPhase
                val wave = sin(phase * TWO_PI)
                val bob = if (working) 0.045f else 0.009f
                translationY = if (animated) wave * sizePx * bob else 0f
                rotationZ = if (animated && working) sin(phase * TWO_PI + 0.8f) * 2.8f else 0f
                val squash = if (animated) wave * (if (working) 0.022f else 0.006f) else 0f
                scaleX = 1f - squash
                scaleY = 1f + squash
                transformOrigin = TransformOrigin(0.5f, 0.62f)
                alpha = if (status == ConnectionStatus.OFFLINE) 0.4f else 1f
            }
    ) {
        val canvasSize = this.size
        val unit = canvasSize.minDimension / DESIGN_SIZE
        val left = (canvasSize.width - DESIGN_SIZE * unit) / 2f
        val top = (canvasSize.height - DESIGN_SIZE * unit) / 2f
        withTransform({
            translate(left, top)
            scale(unit, unit, pivot = Offset.Zero)
        }) {
            drawBotBody(geometry, paint)
            val blink = if (animated) blinkFactor(blinkPhase, blinkOffset) else 1f
            drawBotEyes(geometry, resolvedShape, blink, paint)
            if (working && animated) {
                drawWorkingDots(motionPhase, paint)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Deterministic appearance (mirrors grokMotionEngine.js default*ForSeed)
// ---------------------------------------------------------------------------

/** FNV-1a over UTF-16 code units, as in the desktop engine. */
private fun hashSeed(seed: String): Int {
    var hash = -2128831035 // 2166136261u
    for (char in seed) {
        hash = hash xor char.code
        hash *= 16777619
    }
    return hash
}

/** Desktop `En`: avalanche mixing of the seed hash. */
private fun mixSeed(hash: Int): Int {
    var value = hash
    value = (value xor (value ushr 16)) * 73244475
    value = (value xor (value ushr 13)) * -1028477387 // 3266489909u
    return value xor (value ushr 16)
}

private fun defaultShapeForSeed(seed: String): String {
    val index = (Integer.toUnsignedLong(mixSeed(hashSeed(seed))) % DefaultShapeIds.size).toInt()
    return DefaultShapeIds[index]
}

/** First output of the desktop mulberry32-style PRNG. */
private fun firstRandom(seed: Int): Float {
    var state = seed + 1831565813
    var value = (state xor (state ushr 15)) * (1 or state)
    value = (value + ((value xor (value ushr 7)) * (61 or value))) xor value
    val unsigned = (value xor (value ushr 14)).toLong() and 0xFFFFFFFFL
    return (unsigned.toDouble() / 4294967296.0).toFloat()
}

private fun defaultColorForSeed(seed: String): String {
    val index = (firstRandom(hashSeed(seed)) * DefaultColorIds.size).toInt()
        .coerceIn(0, DefaultColorIds.lastIndex)
    return DefaultColorIds[index]
}

private fun resolveShape(seed: String, shape: String?): String {
    val normalized = shape?.trim()?.lowercase()
    if (normalized != null && normalized in SupportedShapeIds) return normalized
    if (seed == "bothub-brand" || seed == "grok-bot") return "blob"
    return defaultShapeForSeed(seed)
}

private fun resolveColor(seed: String, color: String?, shape: String): String {
    val normalized = color?.trim()?.lowercase()
    if (normalized != null && normalized in BotColorSpecs) return normalized
    if (shape == "pumpkin") return "orange"
    if (seed == "bothub-brand" || seed == "grok-bot") return "black"
    return defaultColorForSeed(seed)
}

// ---------------------------------------------------------------------------
// Paint palette
// ---------------------------------------------------------------------------

private class BotPaint(
    val bodyBrush: Brush,
    val rimBrush: Brush,
    val bottomShade: Brush,
    val gloss: Brush,
    val ground: Brush,
    val eye: Color,
    val eyeGlint: Color,
    val eyeRim: Color,
    val dotGlow: Color,
    val dotCore: Color,
    val facetLight: Color,
    val facetDark: Color,
    val stem: Color,
    val vein: Color,
    val rib: Color
)

private fun buildPaint(spec: BotColorSpec, isDark: Boolean): BotPaint {
    val base = if (isDark) spec.dark else spec.light
    val top = mix(base, Color.White, 0.34f)
    val bottom = mix(base, Color.Black, 0.24f)
    val luminance = base.red * 0.299f + base.green * 0.587f + base.blue * 0.114f
    return BotPaint(
        bodyBrush = Brush.linearGradient(
            colorStops = arrayOf(
                0f to top,
                0.48f to base,
                1f to bottom
            ),
            start = Offset(20f, 4f),
            end = Offset(82f, 98f)
        ),
        rimBrush = Brush.linearGradient(
            colorStops = arrayOf(
                0f to Color.White.copy(alpha = 0.55f),
                0.45f to Color.White.copy(alpha = 0.06f),
                1f to Color.Black.copy(alpha = 0.25f)
            ),
            start = Offset(10f, 4f),
            end = Offset(90f, 98f)
        ),
        bottomShade = Brush.radialGradient(
            colors = listOf(Color.Black.copy(alpha = 0.30f), Color.Transparent),
            center = Offset(50f, 108f),
            radius = 64f
        ),
        gloss = Brush.radialGradient(
            colors = listOf(
                Color.White.copy(alpha = 0.55f),
                Color.White.copy(alpha = 0.16f),
                Color.Transparent
            ),
            center = Offset(34f, 20f),
            radius = 42f
        ),
        ground = Brush.radialGradient(
            colors = listOf(Color.Black.copy(alpha = 0.20f), Color.Transparent),
            center = Offset(50f, 94f),
            radius = 38f
        ),
        eye = Color(0xFF101116),
        eyeGlint = Color.White.copy(alpha = 0.85f),
        eyeRim = if (luminance < 0.18f) Color.White.copy(alpha = 0.22f) else Color.Transparent,
        dotGlow = mix(base, Color.White, 0.50f).copy(alpha = 0.35f),
        dotCore = mix(base, Color.White, 0.82f),
        facetLight = Color.White.copy(alpha = 0.16f),
        facetDark = Color.Black.copy(alpha = 0.10f),
        stem = Color(0xFF6B4423),
        vein = Color.Black.copy(alpha = 0.14f),
        rib = Color.Black.copy(alpha = 0.12f)
    )
}

private fun mix(from: Color, to: Color, amount: Float): Color {
    val t = amount.coerceIn(0f, 1f)
    return Color(
        red = from.red + (to.red - from.red) * t,
        green = from.green + (to.green - from.green) * t,
        blue = from.blue + (to.blue - from.blue) * t,
        alpha = from.alpha + (to.alpha - from.alpha) * t
    )
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

private class BotFacet(val path: Path, val light: Boolean)

private class BotGeometry(
    val body: Path,
    val bounds: Rect,
    val stem: Path?,
    val facets: List<BotFacet>,
    val ribs: List<Path>,
    val veins: List<Path>
)

private fun buildGeometry(shape: String): BotGeometry {
    val body = shapePath(shape)
    val facets = when (shape) {
        "gem" -> listOf(
            BotFacet(
                Path().apply {
                    moveTo(50f, 7f)
                    lineTo(84f, 26f)
                    lineTo(50f, 43f)
                    lineTo(16f, 26f)
                    close()
                },
                light = true
            )
        )
        "crystal" -> listOf(
            BotFacet(
                Path().apply {
                    moveTo(50f, 4f)
                    lineTo(26f, 18f)
                    lineTo(42f, 54f)
                    lineTo(50f, 97f)
                    close()
                },
                light = true
            ),
            BotFacet(
                Path().apply {
                    moveTo(50f, 4f)
                    lineTo(74f, 18f)
                    lineTo(58f, 54f)
                    lineTo(50f, 97f)
                    close()
                },
                light = false
            )
        )
        else -> emptyList()
    }
    val ribs = if (shape == "pumpkin") listOf(
        Path().apply {
            moveTo(36f, 18f)
            cubicTo(28f, 38f, 28f, 70f, 38f, 93f)
        },
        Path().apply {
            moveTo(64f, 18f)
            cubicTo(72f, 38f, 72f, 70f, 62f, 93f)
        }
    ) else emptyList()
    val veins = if (shape == "leaf") listOf(
        Path().apply {
            moveTo(50f, 14f)
            cubicTo(49f, 38f, 51f, 62f, 50f, 88f)
        },
        Path().apply {
            moveTo(50f, 36f)
            cubicTo(40f, 42f, 32f, 50f, 26f, 60f)
        },
        Path().apply {
            moveTo(50f, 36f)
            cubicTo(60f, 42f, 68f, 50f, 74f, 60f)
        }
    ) else emptyList()
    val stem = if (shape == "pumpkin") {
        Path().apply {
            moveTo(46f, 19f)
            cubicTo(44f, 12f, 46f, 5f, 50f, 4f)
            cubicTo(54f, 3f, 56f, 9f, 54f, 19f)
            close()
        }
    } else {
        null
    }
    return BotGeometry(
        body = body,
        bounds = body.getBounds(),
        stem = stem,
        facets = facets,
        ribs = ribs,
        veins = veins
    )
}

private fun shapePath(shape: String): Path = when (shape) {
    "blob" -> Path().apply {
        moveTo(50f, 7f)
        cubicTo(66f, 5f, 80f, 12f, 87f, 26f)
        cubicTo(95f, 40f, 94f, 60f, 85f, 74f)
        cubicTo(76f, 88f, 62f, 95f, 48f, 93f)
        cubicTo(31f, 91f, 16f, 80f, 10f, 64f)
        cubicTo(3f, 47f, 8f, 27f, 22f, 16f)
        cubicTo(30f, 9f, 40f, 7f, 50f, 7f)
        close()
    }
    "pebble" -> Path().apply {
        moveTo(18f, 30f)
        cubicTo(29f, 12f, 52f, 8f, 70f, 12f)
        cubicTo(88f, 16f, 97f, 32f, 94f, 50f)
        cubicTo(91f, 69f, 78f, 86f, 58f, 90f)
        cubicTo(38f, 94f, 16f, 84f, 9f, 66f)
        cubicTo(3f, 50f, 7f, 40f, 18f, 30f)
        close()
    }
    "bean" -> Path().apply {
        moveTo(60f, 10f)
        cubicTo(78f, 9f, 92f, 22f, 92f, 40f)
        cubicTo(92f, 56f, 82f, 64f, 72f, 70f)
        cubicTo(64f, 75f, 62f, 86f, 52f, 91f)
        cubicTo(36f, 98f, 18f, 88f, 12f, 72f)
        cubicTo(6f, 55f, 14f, 38f, 28f, 30f)
        cubicTo(38f, 24f, 46f, 12f, 60f, 10f)
        close()
    }
    "egg" -> Path().apply {
        moveTo(50f, 5f)
        cubicTo(68f, 5f, 84f, 28f, 86f, 53f)
        cubicTo(88f, 78f, 73f, 95f, 50f, 95f)
        cubicTo(27f, 95f, 12f, 78f, 14f, 53f)
        cubicTo(16f, 28f, 32f, 5f, 50f, 5f)
        close()
    }
    "squircle" -> Path().apply {
        addRoundRect(RoundRect(6f, 6f, 94f, 94f, CornerRadius(30f, 30f)))
    }
    "tablet" -> Path().apply {
        addRoundRect(RoundRect(5f, 17f, 95f, 83f, CornerRadius(24f, 24f)))
    }
    "capsule" -> Path().apply {
        addRoundRect(RoundRect(21f, 5f, 79f, 95f, CornerRadius(29f, 29f)))
    }
    "cylinder" -> Path().apply {
        moveTo(18f, 24f)
        cubicTo(18f, 12f, 33f, 7f, 50f, 7f)
        cubicTo(67f, 7f, 82f, 12f, 82f, 24f)
        lineTo(82f, 76f)
        cubicTo(82f, 88f, 67f, 93f, 50f, 93f)
        cubicTo(33f, 93f, 18f, 88f, 18f, 76f)
        close()
    }
    "hex" -> roundedPolygon(
        points = listOf(
            Offset(50f, 6f), Offset(88f, 28f), Offset(88f, 72f),
            Offset(50f, 94f), Offset(12f, 72f), Offset(12f, 28f)
        ),
        radius = 10f
    )
    "gem" -> roundedPolygon(
        points = listOf(
            Offset(50f, 7f), Offset(84f, 26f), Offset(91f, 50f), Offset(72f, 82f),
            Offset(50f, 94f), Offset(28f, 82f), Offset(9f, 50f), Offset(16f, 26f)
        ),
        radius = 9f
    )
    "crystal" -> roundedPolygon(
        points = listOf(
            Offset(50f, 4f), Offset(74f, 18f), Offset(82f, 54f), Offset(68f, 88f),
            Offset(50f, 97f), Offset(32f, 88f), Offset(18f, 54f), Offset(26f, 18f)
        ),
        radius = 7f
    )
    "wedge" -> roundedPolygon(
        points = listOf(Offset(18f, 86f), Offset(40f, 10f), Offset(92f, 66f), Offset(78f, 92f)),
        radius = 12f
    )
    "shield" -> roundedPolygon(
        points = listOf(
            Offset(50f, 5f), Offset(88f, 16f), Offset(85f, 52f),
            Offset(50f, 96f), Offset(15f, 52f), Offset(12f, 16f)
        ),
        radius = 10f
    )
    "dome" -> Path().apply {
        moveTo(9f, 88f)
        cubicTo(9f, 93f, 13f, 94f, 19f, 94f)
        lineTo(81f, 94f)
        cubicTo(87f, 94f, 91f, 93f, 91f, 88f)
        lineTo(91f, 58f)
        cubicTo(91f, 30f, 74f, 7f, 50f, 7f)
        cubicTo(26f, 7f, 9f, 30f, 9f, 58f)
        close()
    }
    "arch" -> Path().apply {
        moveTo(15f, 94f)
        lineTo(15f, 52f)
        cubicTo(15f, 25f, 30f, 6f, 50f, 6f)
        cubicTo(70f, 6f, 85f, 25f, 85f, 52f)
        lineTo(85f, 94f)
        close()
    }
    "cloud" -> Path().apply {
        moveTo(25f, 85f)
        cubicTo(13f, 85f, 5f, 77f, 5f, 66f)
        cubicTo(5f, 56f, 12f, 49f, 21f, 47f)
        cubicTo(20f, 35f, 30f, 25f, 42f, 25f)
        cubicTo(48f, 16f, 60f, 12f, 70f, 17f)
        cubicTo(82f, 14f, 92f, 22f, 92f, 34f)
        cubicTo(99f, 40f, 99f, 52f, 94f, 60f)
        cubicTo(98f, 70f, 91f, 82f, 80f, 84f)
        cubicTo(70f, 91f, 56f, 89f, 49f, 84f)
        cubicTo(42f, 89f, 32f, 89f, 25f, 85f)
        close()
    }
    "teardrop" -> Path().apply {
        moveTo(50f, 4f)
        cubicTo(56f, 18f, 72f, 30f, 82f, 45f)
        cubicTo(92f, 60f, 88f, 81f, 72f, 91f)
        cubicTo(60f, 99f, 40f, 99f, 28f, 91f)
        cubicTo(12f, 81f, 8f, 60f, 18f, 45f)
        cubicTo(28f, 30f, 44f, 18f, 50f, 4f)
        close()
    }
    "leaf" -> Path().apply {
        moveTo(50f, 4f)
        cubicTo(72f, 16f, 88f, 34f, 88f, 55f)
        cubicTo(88f, 78f, 70f, 95f, 50f, 96f)
        cubicTo(30f, 95f, 12f, 78f, 12f, 55f)
        cubicTo(12f, 34f, 28f, 16f, 50f, 4f)
        close()
    }
    "square" -> Path().apply {
        addRoundRect(RoundRect(8f, 8f, 92f, 92f, CornerRadius(20f, 20f)))
    }
    "sparkle" -> Path().apply {
        moveTo(50f, 3f)
        quadraticTo(55f, 34f, 96f, 50f)
        quadraticTo(55f, 66f, 50f, 97f)
        quadraticTo(45f, 66f, 4f, 50f)
        quadraticTo(45f, 34f, 50f, 3f)
        close()
    }
    "clover" -> Path().apply {
        moveTo(50f, 40f)
        cubicTo(46f, 20f, 30f, 8f, 18f, 14f)
        cubicTo(4f, 21f, 8f, 40f, 26f, 46f)
        cubicTo(10f, 52f, 4f, 70f, 16f, 80f)
        cubicTo(28f, 90f, 44f, 76f, 50f, 58f)
        cubicTo(56f, 76f, 72f, 90f, 84f, 80f)
        cubicTo(96f, 70f, 90f, 52f, 74f, 46f)
        cubicTo(92f, 40f, 96f, 21f, 82f, 14f)
        cubicTo(70f, 8f, 54f, 20f, 50f, 40f)
        close()
    }
    "flower" -> petalPath(petals = 6, innerRadius = 24f, outerRadius = 46f)
    "heart" -> Path().apply {
        moveTo(50f, 94f)
        cubicTo(22f, 76f, 5f, 57f, 5f, 37f)
        cubicTo(5f, 19f, 19f, 6f, 36f, 6f)
        cubicTo(45f, 6f, 50f, 13f, 50f, 22f)
        cubicTo(50f, 13f, 55f, 6f, 64f, 6f)
        cubicTo(81f, 6f, 95f, 19f, 95f, 37f)
        cubicTo(95f, 57f, 78f, 76f, 50f, 94f)
        close()
    }
    "house" -> roundedPolygon(
        points = listOf(Offset(50f, 5f), Offset(91f, 33f), Offset(91f, 88f), Offset(9f, 88f), Offset(9f, 33f)),
        radius = 10f
    )
    "star" -> roundedPolygon(
        points = starPoints(points = 5, outerRadius = 47f, innerRadius = 21f),
        radius = 5f
    )
    "pumpkin" -> Path().apply {
        moveTo(50f, 17f)
        cubicTo(64f, 12f, 78f, 17f, 84f, 30f)
        cubicTo(91f, 44f, 92f, 64f, 84f, 78f)
        cubicTo(76f, 91f, 63f, 96f, 50f, 96f)
        cubicTo(37f, 96f, 24f, 91f, 16f, 78f)
        cubicTo(8f, 64f, 9f, 44f, 16f, 30f)
        cubicTo(22f, 17f, 36f, 12f, 50f, 17f)
        close()
    }
    else -> shapePath("blob")
}

private fun roundedPolygon(points: List<Offset>, radius: Float): Path {
    val path = Path()
    if (points.size < 3) return path

    fun unit(from: Offset, to: Offset): Offset {
        val dx = to.x - from.x
        val dy = to.y - from.y
        val length = sqrt(dx * dx + dy * dy)
        return if (length > 0.0001f) Offset(dx / length, dy / length) else Offset(1f, 0f)
    }

    val first = points[0]
    val firstOut = unit(first, points[1])
    path.moveTo(first.x + firstOut.x * radius, first.y + firstOut.y * radius)
    for (index in points.indices) {
        val current = points[index]
        val next = points[(index + 1) % points.size]
        val previous = points[(index - 1 + points.size) % points.size]
        val incoming = unit(current, previous)
        val outgoing = unit(current, next)
        val before = Offset(current.x + incoming.x * radius, current.y + incoming.y * radius)
        val after = Offset(current.x + outgoing.x * radius, current.y + outgoing.y * radius)
        if (index > 0) path.lineTo(before.x, before.y)
        path.quadraticTo(current.x, current.y, after.x, after.y)
    }
    path.close()
    return path
}

private fun starPoints(points: Int, outerRadius: Float, innerRadius: Float): List<Offset> {
    val result = ArrayList<Offset>(points * 2)
    val center = 50f
    val step = PI / points
    var angle = -PI / 2
    for (index in 0 until points * 2) {
        val radius = if (index % 2 == 0) outerRadius else innerRadius
        result += Offset(
            center + cos(angle).toFloat() * radius,
            center + sin(angle).toFloat() * radius + 2f
        )
        angle += step
    }
    return result
}

private fun petalPath(petals: Int, innerRadius: Float, outerRadius: Float): Path {
    val path = Path()
    val center = 50f
    val step = (TWO_PI / petals)
    val startAngle = -PI.toFloat() / 2f

    fun point(radius: Float, angle: Float): Offset =
        Offset(center + cos(angle) * radius, center + sin(angle) * radius)

    val first = point(innerRadius, startAngle)
    path.moveTo(first.x, first.y)
    for (index in 0 until petals) {
        val angle = startAngle + index * step
        val outer = point(outerRadius, angle + step / 2f)
        val next = point(innerRadius, angle + step)
        path.quadraticTo(outer.x, outer.y, next.x, next.y)
    }
    path.close()
    return path
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

private fun DrawScope.drawBotBody(geometry: BotGeometry, paint: BotPaint) {
    drawOval(
        brush = paint.ground,
        topLeft = Offset(13f, 85f),
        size = Size(74f, 13f)
    )
    geometry.stem?.let { drawPath(it, paint.stem) }
    drawPath(geometry.body, paint.bodyBrush)
    clipPath(geometry.body) {
        drawCircle(brush = paint.bottomShade, radius = 62f, center = Offset(50f, 108f))
        drawOval(brush = paint.gloss, topLeft = Offset(22f, 10f), size = Size(46f, 30f))
        for (index in geometry.ribs.indices) {
            drawPath(geometry.ribs[index], color = paint.rib, style = Stroke(width = 2.4f))
        }
        for (index in geometry.veins.indices) {
            drawPath(geometry.veins[index], color = paint.vein, style = Stroke(width = 1.3f))
        }
    }
    drawPath(geometry.body, brush = paint.rimBrush, style = Stroke(width = 1.15f))
    for (index in geometry.facets.indices) {
        val facet = geometry.facets[index]
        drawPath(
            path = facet.path,
            color = if (facet.light) paint.facetLight else paint.facetDark
        )
    }
}

private fun eyeYFraction(shape: String): Float = when (shape) {
    "house" -> 0.55f
    "star" -> 0.48f
    "heart" -> 0.40f
    "flower", "clover" -> 0.47f
    "dome", "arch" -> 0.46f
    "capsule", "cylinder" -> 0.38f
    else -> 0.42f
}

private fun DrawScope.drawBotEyes(
    geometry: BotGeometry,
    shape: String,
    blink: Float,
    paint: BotPaint
) {
    val bounds = geometry.bounds
    val oneEye = shape in OneEyeShapes
    val minDimension = minOf(bounds.width, bounds.height)
    val radiusX = (minDimension * if (oneEye) 0.095f else 0.073f).coerceIn(2.4f, 7f)
    val radiusY = radiusX * 1.32f
    val eyeY = bounds.top + bounds.height * eyeYFraction(shape)
    if (oneEye) {
        drawEye(bounds.center.x, eyeY, radiusX, radiusY, blink, paint)
    } else {
        val gap = bounds.width * 0.13f
        drawEye(bounds.center.x - gap, eyeY, radiusX, radiusY, blink, paint)
        drawEye(bounds.center.x + gap, eyeY, radiusX, radiusY, blink, paint)
    }
}

private fun DrawScope.drawEye(
    centerX: Float,
    centerY: Float,
    radiusX: Float,
    radiusY: Float,
    blink: Float,
    paint: BotPaint
) {
    val openHeight = (radiusY * blink).coerceAtLeast(0.28f)
    if (paint.eyeRim.alpha > 0f) {
        val rim = 0.75f
        drawOval(
            color = paint.eyeRim,
            topLeft = Offset(centerX - radiusX - rim, centerY - openHeight - rim),
            size = Size((radiusX + rim) * 2f, (openHeight + rim) * 2f)
        )
    }
    drawOval(
        color = paint.eye,
        topLeft = Offset(centerX - radiusX, centerY - openHeight),
        size = Size(radiusX * 2f, openHeight * 2f)
    )
    if (blink > 0.4f) {
        drawCircle(
            color = paint.eyeGlint,
            radius = radiusX * 0.30f,
            center = Offset(centerX - radiusX * 0.30f, centerY - openHeight * 0.38f)
        )
    }
}

private fun DrawScope.drawWorkingDots(phase: Float, paint: BotPaint) {
    val baseAngle = phase * TWO_PI
    for (index in 0..2) {
        val angle = baseAngle + index * (TWO_PI / 3f)
        val radius = 44f + 2f * sin(angle * 2f)
        val center = Offset(50f + cos(angle) * radius, 50f + sin(angle) * radius)
        drawCircle(color = paint.dotGlow, radius = 3.8f, center = center)
        drawCircle(color = paint.dotCore, radius = 1.6f, center = center)
    }
}

private fun blinkFactor(progress: Float, offset: Float): Float {
    val phase = (progress + offset) % 1f
    val start = 0.93f
    val end = 0.972f
    if (phase < start || phase > end) return 1f
    val t = (phase - start) / (end - start)
    val closed = 1f - abs(t * 2f - 1f)
    return 1f - 0.94f * closed
}
