package com.qybaihe.botark.ui.screens

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import com.qybaihe.botark.viewmodel.BotArkUiState
import com.qybaihe.botark.viewmodel.BotArkViewModel
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Hosts the exact Linux renderer bundle in an Android WebView.
 *
 * Native Android keeps the privileged pieces (pairing, WebSocket, Hark/Hermes
 * direct sessions, proxy core). The renderer receives workspace snapshots over
 * [BotArkNative] and sends user actions back through the same channel, so list,
 * chat, markdown, tool cards, approvals and GrokBotMark animations all share
 * one implementation with the Linux desktop.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebWorkspaceScreen(
    viewModel: BotArkViewModel,
    state: BotArkUiState,
    onOpenNative: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val scope = rememberCoroutineScope()
    var webView by remember { mutableStateOf<WebView?>(null) }

    BackHandler {
        val view = webView
        if (view != null && view.canGoBack()) view.goBack() else onBack()
    }

    AndroidView(
        modifier = modifier.fillMaxSize(),
        factory = { context ->
            WebView(context).apply {
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                settings.cacheMode = WebSettings.LOAD_DEFAULT
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                webViewClient = object : WebViewClientCompat() {
                    private val assetLoader = WebViewAssetLoader.Builder()
                        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
                        .build()

                    override fun shouldInterceptRequest(
                        view: WebView,
                        request: WebResourceRequest
                    ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        val url = request.url
                        if (url.host == "appassets.androidplatform.net") return false
                        if (url.scheme == "http" || url.scheme == "https") {
                            runCatching {
                                context.startActivity(
                                    android.content.Intent(android.content.Intent.ACTION_VIEW, url)
                                        .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                                )
                            }
                            return true
                        }
                        return false
                    }
                }
                webChromeClient = object : WebChromeClient() {
                    override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
                        if (result == null) return false
                        AlertDialog.Builder(context)
                            .setMessage(message)
                            .setPositiveButton("确定") { _, _ -> result.confirm() }
                            .setNegativeButton("取消") { _, _ -> result.cancel() }
                            .setOnCancelListener { result.cancel() }
                            .show()
                        return true
                    }

                    override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
                        if (result == null) return false
                        AlertDialog.Builder(context)
                            .setMessage(message)
                            .setPositiveButton("确定") { _, _ -> result.confirm() }
                            .setOnCancelListener { result.cancel() }
                            .show()
                        return true
                    }
                }
                addJavascriptInterface(
                    NativeBridge(
                        viewModel = viewModel,
                        scope = scope,
                        webViewProvider = { webView },
                        onOpenNative = onOpenNative
                    ),
                    "BotArkNative"
                )
                loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
                webView = this
            }
        },
        update = { view -> webView = view }
    )

    LaunchedEffect(state) {
        val target = webView ?: return@LaunchedEffect
        val raw = viewModel.bridgeStateJson()
        target.evaluateJavascript(
            "window.__botarkNativeState && window.__botarkNativeState(" + JSONObject.quote(raw) + ")",
            null
        )
    }
}

private class NativeBridge(
    private val viewModel: BotArkViewModel,
    private val scope: kotlinx.coroutines.CoroutineScope,
    private val webViewProvider: () -> WebView?,
    private val onOpenNative: (String) -> Unit
) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun getState(): String = viewModel.bridgeStateJson()

    @JavascriptInterface
    fun command(action: String, argsJson: String): String {
        main.post {
            if (action == "openNative") {
                val screen = runCatching {
                    JSONObject(argsJson).optString("screen")
                }.getOrDefault("")
                if (screen.isNotBlank()) onOpenNative(screen)
            } else {
                viewModel.bridgeCommand(action, argsJson)
            }
        }
        return "{\"ok\":true}"
    }

    @JavascriptInterface
    fun harkRpc(requestJson: String, callbackId: String) {
        scope.launch {
            val result = viewModel.harkBridgeRpc(requestJson)
            main.post {
                webViewProvider()?.evaluateJavascript(
                    "window.__botarkNativeHarkResult && window.__botarkNativeHarkResult(" +
                        JSONObject.quote(callbackId) + ", " + JSONObject.quote(result) + ")",
                    null
                )
            }
        }
    }
}
