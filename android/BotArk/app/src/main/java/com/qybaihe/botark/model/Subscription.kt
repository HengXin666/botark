package com.qybaihe.botark.model

import kotlinx.serialization.Serializable

/** Format labels produced by subscription content sniffing. */
object SubscriptionFormat {
    const val URI_LIST = "uri-list"
    const val BASE64_URI_LIST = "base64-uri-list"
    const val CLASH_YAML = "clash-yaml"
    const val HTTP_PLAIN_LINES = "http-plain-lines"
    const val UNKNOWN = "unknown"
}

/** An HTTP/SOCKS5 endpoint extracted from a subscription. */
@Serializable
data class ProxyNode(
    val mode: String,
    val host: String,
    val port: Int,
    val username: String? = null,
    val password: String? = null
)

/** A subscription entry that is not an HTTP/SOCKS5 endpoint, with the reason it was skipped. */
@Serializable
data class SkippedNode(
    val scheme: String,
    val reason: String
)

/** Outcome of parsing one subscription body: format, kept nodes, skipped entries and errors. */
@Serializable
data class SubscriptionParseResult(
    val format: String = SubscriptionFormat.UNKNOWN,
    val nodes: List<ProxyNode> = emptyList(),
    val skipped: List<SkippedNode> = emptyList(),
    val errors: List<String> = emptyList()
)

/** Non-sensitive response metadata for one subscription fetch. */
@Serializable
data class SubscriptionFetchMeta(
    val httpCode: Int = 0,
    val contentType: String? = null,
    val contentLength: Long = -1L,
    val redactedUrl: String = "",
    val fetchedAtMs: Double = 0.0
)

/** Subscription body plus its non-sensitive metadata. */
@Serializable
data class SubscriptionFetchResult(
    val text: String,
    val meta: SubscriptionFetchMeta
)

/** Last successful fetch, stored only in the encrypted vault. */
@Serializable
data class SubscriptionRecord(
    val redactedUrl: String = "",
    val fetchedAtMs: Double = 0.0,
    val result: SubscriptionParseResult = SubscriptionParseResult()
)
