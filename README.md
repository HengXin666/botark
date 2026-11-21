<div align="center">

<img src="docs/assets/logo.png" alt="BotArk" width="108" />

# BotArk

**All your personal AI agents, in one native desktop workspace.**

Stop juggling five separate apps and a dozen incognito browser profiles.<br />
Run **Grok Bot**, **ChatGPT Dot**, **Meta Muse**, **Hark**, and open-source **Hermes** side by side on macOS, Windows & Linux.

<p>
  <a href="https://github.com/HengXin666/botark/releases/latest"><img src="https://img.shields.io/github/v/release/HengXin666/botark?style=flat-square&label=Release&color=2563eb" alt="Latest Release" /></a>
  <a href="https://github.com/HengXin666/botark/releases/latest"><img src="https://img.shields.io/badge/macOS-Signed_%26_Notarized-16a34a?style=flat-square&logo=apple&logoColor=white" alt="Apple Signed & Notarized" /></a>
  <a href="https://github.com/HengXin666/botark/releases/latest"><img src="https://img.shields.io/badge/Windows-10%2F11_x64-0078d4?style=flat-square&logo=windows&logoColor=white" alt="Windows 10/11" /></a>
  <a href="https://github.com/HengXin666/botark/releases/latest"><img src="https://img.shields.io/badge/Linux-x64_AppImage-FCC624?style=flat-square&logo=linux&logoColor=black" alt="Linux AppImage" /></a>
  <a href="https://github.com/HengXin666/botark/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/HengXin666/botark/ci.yml?branch=main&style=flat-square&label=CI" alt="CI Status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-0ea5e9?style=flat-square" alt="MIT License" /></a>
</p>

<h4>
  <a href="https://qybaihe.github.io/botark/">🌐 Official Website</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/HengXin666/botark/releases/latest">🍎 Download for Mac (Apple Silicon)</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/HengXin666/botark/releases/latest">💻 Download for Mac (Intel)</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/HengXin666/botark/releases/latest">🪟 Download for Windows</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/HengXin666/botark/releases/latest">🐧 Download for Linux</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/HengXin666/botark/discussions">💬 Discussions</a>
</h4>

<sub>
  <b>English</b> ·
  <a href="docs/readme/README_zh.md">简体中文</a> ·
  <a href="docs/readme/README_zh-TW.md">繁體中文</a> ·
  <a href="docs/readme/README_ja.md">日本語</a> ·
  <a href="docs/readme/README_ko.md">한국어</a> ·
  <a href="docs/readme/README_es.md">Español</a> ·
  <a href="docs/readme/README_fr.md">Français</a> ·
  <a href="docs/readme/README_de.md">Deutsch</a> ·
  <a href="docs/readme/README_pt-BR.md">Português</a> ·
  <a href="docs/readme/README_ru.md">Русский</a> ·
  <a href="docs/readme/README_it.md">Italiano</a> ·
  <a href="docs/readme/README_vi.md">Tiếng Việt</a> ·
  <a href="docs/readme/README_tr.md">Türkçe</a> ·
  <a href="docs/readme/README_ar.md">العربية</a> ·
  <a href="docs/readme/README_id.md">Indonesia</a> ·
  <a href="docs/readme/README_hi.md">हिन्दी</a>
</sub>

</div>

<br />

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/botark-dark.webp" />
    <img src="docs/assets/botark-light.webp" alt="BotArk three-column desktop workspace" width="100%" />
  </picture>
</div>

---

## ✨ How BotArk Works

Modern personal agents do far more than chat — they run background subagents, keep long-term memories, execute scheduled jobs, and work inside cloud sandboxes. Yet once you use more than one platform (or keep separate work and personal accounts), your workflow fragments across scattered tabs and logins.

**BotArk brings the entire workflow back into one calm, predictable rhythm:**

<table>
  <tr>
    <td width="46%" valign="middle">
      <h3>1. Connect any account in seconds</h3>
      <p>Whether you prefer signing in interactively or importing credentials in bulk, BotArk gets out of your way:</p>
      <ul>
        <li><b>Window or 1-Click Browser Auth</b> that automatically respects your system proxy</li>
        <li><b>Direct Credential Paste</b> for Access Tokens, Session Cookies, JSON exports, or API Keys</li>
        <li><b>Batch Fleet Import</b> to onboard dozens of Meta Muse or ChatGPT Dot accounts at once</li>
      </ul>
    </td>
    <td width="54%" valign="middle">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/feature-platforms-dark.webp" />
        <img src="docs/assets/feature-platforms-light.webp" alt="BotArk account onboarding and platform overview" width="100%" />
      </picture>
    </td>
  </tr>
  <tr>
    <td width="54%" valign="middle">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/feature-accounts-dark.webp" />
        <img src="docs/assets/feature-accounts-light.webp" alt="BotArk multi-account console and Grok multi-bot roster sync" width="100%" />
      </picture>
    </td>
    <td width="46%" valign="middle">
      <h3>2. Isolate accounts below, expand every bot above</h3>
      <p>Under the hood, every account runs inside its own sandboxed Chromium partition and OS Keychain slot — so multiple accounts on the same platform never mix sessions.</p>
      <p>On the surface, your sidebar stays organized around <b>individual bots</b>: sign into a single <b>Grok Bot</b> account and every specialized agent &amp; room on it expands into your sidebar automatically, with optional 1-to-1 <code>SOCKS5</code> / <code>HTTP</code> proxy binding per account.</p>
    </td>
  </tr>
</table>

<table>
  <tr>
    <td width="33%" valign="top">
      <h4>🗂️ Cross-Platform Grouping (<code>⌘K</code>)</h4>
      Group Grok, Muse, Dot, and Hark bots together by project rather than by vendor. Pin daily drivers and switch conversations instantly from the keyboard.
    </td>
    <td width="33%" valign="top">
      <h4>🛠️ Right-Side Workbench (<code>⌘I</code>)</h4>
      Keep the center conversation clean. Open the right panel only when you need to inspect subagent runs, edit memories &amp; skills, manage cron schedules, or download sandbox files.
    </td>
    <td width="34%" valign="top">
      <h4>🛡️ Safe Delivery &amp; Zero Telemetry</h4>
      Every message tracks <i>sending</i>, <i>accepted</i>, or <i>failed</i> so retries never double-send. All data stays strictly on your machine with zero cloud relays or analytics.
    </td>
  </tr>
</table>

---

## 🤖 Platform Capabilities at a Glance

Rather than wrapping web pages in generic tabs, BotArk adapts the right-side workbench (`⌘I`) to each platform's native protocol:

| Platform | Sign-In & Import Paths | Account → Sidebar Mapping | Native Workbench (`⌘I`) |
| :--- | :--- | :--- | :--- |
| <img src="src/renderer/src/assets/platforms/grok.png" width="18" height="18" align="absmiddle" /> **Grok Bot** | Login window, **1-click browser auth**, or Token / Cookie / JSON / API Key | **1 account → many bots** (auto-syncs all agents & rooms; create new bots in place) | Sessions, subagent tasks, automations, memories & skills, file library, cloud sandbox, MCP connectors & recipes |
| <img src="src/renderer/src/assets/platforms/muse.svg" width="18" height="18" align="absmiddle" /> **Meta Muse** | Partition login window or **batch email OTP auto-import** | 1 isolated account → 1 Muse bot (supports 10+ parallel accounts) | Quota monitor, Sentinel approvals, session history, cron schedules, goals, memories, skills, file preview & cloud VM |
| <img src="src/renderer/src/assets/platforms/dot.svg" width="18" height="18" align="absmiddle" /> **ChatGPT Dot** | Web login window or **single / multi-line AT, RT & JSON import** | 1 account → 1 Dot bot with automatic Refresh Token renewal | Orbit persona switcher, Dot / Native modes, core goal editor, **1-click cross-account memory migration**, Pages & Library |
| <img src="src/renderer/src/assets/platforms/hark.svg" width="18" height="18" align="absmiddle" /> **Hark** | Google / email login window or **Session Cookie paste** | 1 account → 1 Hark bot | Workflow cards, conversation switcher, scheduled tasks, generated file library, live cloud browser view & connectors |
| <img src="src/renderer/src/assets/platforms/hermes.png" width="18" height="18" align="absmiddle" /> **Hermes** | **Auto-detect local `~/.hermes`** or enter remote API Server URL & `API_SERVER_KEY` (Keychain-encrypted) | 1 server / profile (`/p/<name>`) → 1 Hermes bot (multi-instance) | Native Session SSE streaming & live tool calls, dangerous-command approvals, persistent session switcher, Cron jobs, Skills & Toolsets |

---

## 📱 Native iOS & Android Companion Apps (100% Zero-Server QR Sync)

Take all 5 platforms with you on **iPhone & Android** — **without deploying or trusting any cloud server**:

<div align="center">
  <table>
    <tr>
      <td align="center" width="25%">
        <img src="docs/assets/ios-onboarding.png" alt="BotArk iOS QR Pairing" width="100%" /><br />
        <sub><b>iOS · Scan QR to Pair</b><br />Zero cloud account</sub>
      </td>
      <td align="center" width="25%">
        <img src="docs/assets/ios-synced.png" alt="BotArk iOS Synced 5-Platform List" width="100%" /><br />
        <sub><b>iOS · 5 Platforms Live</b><br />LAN / Tailscale bridge</sub>
      </td>
      <td align="center" width="25%">
        <img src="docs/assets/android-chat.png" alt="BotArk Android Chat & Approvals" width="100%" /><br />
        <sub><b>Android · Chat &amp; Approvals</b><br />Tool calls + 1-tap allow/deny</sub>
      </td>
      <td align="center" width="25%">
        <img src="docs/assets/android-sync-settings.png" alt="BotArk Android Zero-Server Sync" width="100%" /><br />
        <sub><b>Android · Offline &amp; Keystore</b><br />Encrypted bundle + Hermes direct</sub>
      </td>
    </tr>
  </table>
</div>

- **Zero-Server LAN / Hotspot / Tailscale Live Bridge**: Click the QR icon in BotArk Desktop's sidebar and scan with **BotArk for iOS** (SwiftUI, `ios/BotArk`) or **BotArk for Android** (Jetpack Compose, `android/BotArk` — zero GMS required). Instantly syncs all Grok Bot, Meta Muse, ChatGPT Dot, Hark & Hermes bots, streaming chats, tool calls, and 1-tap security approvals.
- **AES-256-GCM Offline Sync Bundle (`.botark-sync`)**: Export an encrypted workspace snapshot from Desktop and transfer via AirDrop / Quick Share / USB when off the same Wi-Fi.
- **Hermes Direct Mode (Works While Computer Is Asleep)**: Opt-in end-to-end AES-256-GCM credential handoff into iOS Keychain / Android Keystore lets your phone stream directly from remote Hermes instances even when your Mac/PC is offline.

👉 **iOS (SwiftUI)**: [**`ios/BotArk/README.md`**](ios/BotArk/README.md) · **Android (Jetpack Compose + Direct APK)**: [**`android/BotArk/README.md`**](android/BotArk/README.md) & [**GitHub Releases**](https://github.com/HengXin666/botark/releases/latest)

---

## ⚡ Quick Start

### 1. Install BotArk

Download the latest installer from [**GitHub Releases**](https://github.com/HengXin666/botark/releases/latest):

| Platform | Package | Notes |
| :--- | :--- | :--- |
| **macOS (Apple Silicon M1–M4)** | `BotArk-<version>-arm64.dmg` | ✅ **Apple Developer ID signed & notarized** — drag into `Applications` and open directly |
| **macOS (Intel x64)** | `BotArk-<version>-x64.dmg` | ✅ **Apple Developer ID signed & notarized** — no Gatekeeper prompts |
| **Windows 10 / 11 (64-bit)** | `BotArk-Setup-<version>-x64.exe` | One-click NSIS installer (preserves local data across upgrades) |
| **Linux (x86_64)** | `BotArk-<version>-x86_64.AppImage` | Single-file AppImage — `chmod +x` and run; needs FUSE 2 or `--appimage-extract-and-run` |

### 2. Add Your First Agent

1. Press **`⌘N` / `Ctrl+N`** (or click **`+`** at the top-left) to connect an account, or open **Settings & Accounts** at the bottom-left for batch imports and proxy pool assignment.
2. Pick any bot in the sidebar to start chatting, and press **`⌘I` / `Ctrl+I`** whenever you want its right-side workbench.

> [!TIP]
> New to BotArk? Click the **✦ Sparkles** icon at the bottom-left of the sidebar anytime to open the built-in **Interactive Walkthrough**.

---

## ⌨️ Keyboard Shortcuts

| Shortcut (macOS / Windows) | Action |
| :--- | :--- |
| `⌘K` / `Ctrl+K` | Open **Command Palette** to search bots, groups, messages, and actions |
| `⌘N` / `Ctrl+N` | Add a new bot or connect an account |
| `⌘I` / `Ctrl+I` | Show or hide the right-side workbench |
| `⌘[` · `⌘]` / `Ctrl+[` · `Ctrl+]` | Jump to the previous / next bot in the sidebar |

---

## 🧰 Development

Requires **Node.js 22.19+** (Node 24 recommended; see [`.nvmrc`](.nvmrc)).

```bash
git clone https://github.com/HengXin666/botark.git
cd botark
npm ci
npm run dev
```

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Start Electron main, preload, and React renderer with hot reload |
| `npm run typecheck` | Type-check Node and renderer TypeScript targets |
| `npm test` | Run the Vitest unit test suite |
| `npm run build` | Build production bundles into `out/` |
| `npm run dist:mac` / `npm run dist:win` | Package macOS `.dmg` + `.zip` or Windows `.exe` installers |
| `npm run dist:linux` | Package a single-file Linux `.AppImage` into `release/` |

### Linux notes

The AppImage carries its own Electron runtime, so it runs on most x86_64 distributions with glibc 2.31+. It keeps Chromium's sandbox enabled through unprivileged user namespaces; on kernels with `kernel.unprivileged_userns_clone=0` launch with `--no-sandbox`. Wayland and X11 are auto-detected (`ELECTRON_OZONE_PLATFORM_HINT=x11` forces X11). Hardware video decoding is opt-in with `BOTARK_LINUX_VAAPI=1` because some proprietary drivers still crash on it.

Interested in contributing or adding another agent platform? See [**CONTRIBUTING.md**](CONTRIBUTING.md) and the protocol notes in [**`docs/`**](docs/README.md).

---

## 🗺️ Roadmap

- [ ] **Claude Duet Integration**: Native adapter & right-side workbench support for Anthropic's **Claude Duet** (proactive tasks, approvals, cloud VM files, memories & skills).
- [ ] **Android & iOS Companion Apps**: Mobile apps for on-the-go agent chat and push alerts, with **direct account import** (Token / Cookie / encrypted local transfer from desktop).
- [ ] **Expanded Fleet & Workflow Tools**: Richer batch import workflows, cross-platform task inbox, and continuous protocol compatibility across all platforms.

---

## ❓ FAQ

<details>
<summary><b>Is BotArk affiliated with xAI, OpenAI, Meta, or Hark?</b></summary>

No. BotArk is an independent, MIT-licensed open-source client. You sign in with your own accounts, and requests go directly from your device to each platform.

</details>

<details>
<summary><b>Will macOS block the app or show Gatekeeper warnings?</b></summary>

No — official macOS `.dmg` releases are signed with an **Apple Developer ID** certificate and **notarized by Apple**, so `BotArk.app` opens right away.

</details>

<details>
<summary><b>How are my tokens and sessions stored? What if I'm upgrading from BotHub?</b></summary>

Everything stays locally on your computer (`~/Library/Application Support/botark` on macOS, `%APPDATA%\botark` on Windows) encrypted via OS Keychain / DPAPI (`safeStorage`). If you previously used `BotHub`, BotArk automatically detects and inherits your existing local data directory with zero account loss.

</details>

---

## 🤝 Community & Acknowledgements

- Built with support and feedback from the [**LINUX DO**](https://linux.do/) community — where builders share ideas openly, honestly, and generously.
- Questions, workflow tips, or new agent platform requests? Join [**GitHub Discussions**](https://github.com/HengXin666/botark/discussions).

---

## 📈 Star History

<div align="center">
  <a href="https://star-history.com/#HengXin666/botark&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=HengXin666/botark&type=Date&theme=dark" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=HengXin666/botark&type=Date" width="100%" />
    </picture>
  </a>
</div>

---

<div align="center">
  Released under the <a href="LICENSE"><b>MIT License</b></a>.<br />
  <sub>If <b>BotArk</b> cleans up your daily agent workflow, a <b>⭐ Star</b> on GitHub is much appreciated!</sub>
</div>
