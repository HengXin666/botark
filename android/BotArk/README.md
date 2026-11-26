# BotArk for Android (Linux Renderer Shell · Zero-Server Companion)

<div align="center">
  <table>
    <tr>
      <td align="center" width="25%">
        <img src="../../docs/assets/android-onboarding.png" width="100%" alt="BotArk Android Onboarding" /><br />
        <sub><b>QR Pairing</b></sub>
      </td>
      <td align="center" width="25%">
        <img src="../../docs/assets/android-synced.png" width="100%" alt="BotArk Android Live Sync" /><br />
        <sub><b>5-Platform List</b></sub>
      </td>
      <td align="center" width="25%">
        <img src="../../docs/assets/android-chat.png" width="100%" alt="BotArk Android Chat & Approvals" /><br />
        <sub><b>Chat &amp; Approvals</b></sub>
      </td>
      <td align="center" width="25%">
        <img src="../../docs/assets/android-sync-settings.png" width="100%" alt="BotArk Android Zero-Server Sync" /><br />
        <sub><b>Zero-Server Sync</b></sub>
      </td>
    </tr>
  </table>
</div>

A **Kotlin/Compose shell around the exact Linux renderer bundle** (Android 8.0+ / API 26+). The workspace, bot list, chat, markdown, tool cards, approvals, Hark project page and animated avatars are the same React UI as BotArk Desktop, rendered in a hardened WebView and driven by a native JS bridge for pairing, the desktop WebSocket, Hark/Hermes direct sessions and the bundled proxy core. Native Compose keeps onboarding, QR pairing, sync settings and platform dialogs. Sync remains **100% Zero-Server** with **zero Google Play Services dependency** (CameraX + offline ZXing QR scanner works on every Android device, including HarmonyOS / HyperOS / ColorOS / OriginOS).

## ✨ Two Zero-Server Sync Channels

1. **Channel 1 — Instant QR Pairing over LAN / Hotspot / Tailscale (All 5 Platforms)**
   - On BotArk Desktop, click the **QR icon** in the left sidebar (or **Settings → 手机扫码同步**) and turn on the local sync bridge (`0.0.0.0:19472`).
   - Scan the QR code with **BotArk for Android**.
   - Automatically probes all LAN and Tailscale IPs in parallel, completes a single-use pairing handshake, stores the per-device Bearer token in **Android Keystore (`EncryptedSharedPreferences`)**, and streams all 5 platforms (`Grok Bot`, `Meta Muse`, `ChatGPT Dot`, `Hark`, `Hermes`) + 1-tap security approvals live over WebSocket.

2. **Channel 2 — Encrypted Offline Sync Bundle (`.botark-sync`) & Hermes Direct Mode**
   - Import **AES-256-GCM** encrypted `.botark-sync` files transferred over USB, Quick Share, or messaging apps without needing the same Wi-Fi.
   - Opt-in encrypted Hermes credentials are decrypted into **Android Keystore**, enabling direct native SSE chat with remote Hermes API servers even when your Mac/PC is asleep — plus manual standalone Hermes server onboarding without a computer.

## 🛠️ Install or Build from Source

### Option 1: Direct APK Install (Fastest)
Download `BotArk-<version>-android.apk` directly from [**GitHub Releases**](https://github.com/qybaihe/botark/releases/latest) and install on any Android 8.0+ phone.

### Option 2: Build from Source with Gradle / Android Studio
Requires Node.js 20+ and npm on the build machine: Gradle's `buildWebRenderer` task runs `npm run build:web` and packages the generated bundle into the APK automatically. On JDK 27 hosts, set `JAVA_HOME` to a JDK 17 installation first (Gradle 8.x does not accept JDK 27).
```bash
cd android/BotArk
./gradlew :app:testDebugUnitTest :app:assembleDebug
```
The compiled APK is output at `app/build/outputs/apk/debug/app-debug.apk`. To install onto a USB-connected phone:
```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 🔐 Security Model
- **Zero Cloud Servers & Zero GMS**: 100% local LAN / Hotspot / Tailscale / offline file transfer; CameraX + ZXing runs completely offline.
- **3-Way Binary-Compatible AES-256-GCM**: Verified by unit tests (`SyncProtocolTest.kt`) against exact Node.js (`mobileSyncCrypto.ts`) and Swift CryptoKit (`SyncCrypto.swift`) vectors.
- **Android Keystore Vault**: Device tokens and Hermes API keys are stored encrypted via Jetpack Security `EncryptedSharedPreferences` (`AES256_GCM`).
