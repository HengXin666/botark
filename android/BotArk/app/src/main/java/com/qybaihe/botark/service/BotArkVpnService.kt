package com.qybaihe.botark.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

/**
 * Foreground service that runs the bundled mihomo core in local mixed-port mode.
 * BotArk clients connect to 127.0.0.1:17890 explicitly; no tun is created, so the
 * core's own upstream sockets cannot be captured by its own proxy interface.
 */
class BotArkVpnService : Service() {
    private var running = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopVpn()
            return START_NOT_STICKY
        }
        val nodes = VpnNodeStore.takePending()
        if (nodes.isNullOrEmpty()) {
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground(NOTIF_ID, buildNotification())
        val ok = MihomoManager.startLocal(this, nodes)
        if (!ok) stopVpn()
        running = ok
        return if (ok) START_STICKY else START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun stopVpn() {
        MihomoManager.stop()
        running = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopVpn()
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "BotArk VPN", NotificationManager.IMPORTANCE_LOW)
            nm.createNotificationChannel(ch)
        }
        val stop = PendingIntent.getService(
            this, 1, Intent(this, BotArkVpnService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("BotArk 代理运行中")
            .setContentText("内置代理内核运行中，仅 BotArk 请求使用")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "停止", stop).build())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            n.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        }
        return n.build()
    }

    companion object {
        const val ACTION_STOP = "com.qybaihe.botark.vpn.STOP"
        private const val CHANNEL_ID = "botark_vpn"
        private const val NOTIF_ID = 4201
    }
}

/** One-shot handoff of the node list from the UI layer into the service. */
object VpnNodeStore {
    private var pending: List<MihomoNode>? = null

    fun put(nodes: List<MihomoNode>) {
        pending = nodes
    }

    fun takePending(): List<MihomoNode>? {
        val v = pending
        pending = null
        return v
    }
}
