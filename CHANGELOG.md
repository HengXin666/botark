# Changelog

All notable changes to **BotArk** (formerly BotHub) are documented in this file.

## [0.12.0] - 2026-11-25

### Added
- **Hark live working status**: the Linux desktop now keeps the Hark conversation sync stream open for the active project and renders the real narration (for example `检查服务连接状态。`) in the chat status bubble, chat header and sidebar, instead of only the generic `正在工作…`. The same watch is restored automatically when a Hark project chat is resumed after a relaunch.
- **Android reuses the Linux renderer**: the phone workspace now runs the same React renderer bundle as the Linux desktop inside a WebView. A single-column mobile shell reuses the existing bot list, message bubbles, markdown, tool cards, approvals, Hark project page and animated `GrokBotMark` avatars; a native JS bridge supplies pairing, sync, Hark/Hermes direct sessions and proxy state. Native Compose keeps only onboarding, QR pairing, sync settings and dialogs.
- **Hark multi-project mode on Android**: the shared Hark project page now has full phone support for multiple projects: recency ordering, a dedicated working section, unread/completed/not-started badges, project search, create/open/delete with native confirmation, cached-status fallback, live status polling, active-project title in the chat header and automatic resume only when exactly one project is working. Native create/delete operations mirror the project list back into the phone snapshot so a later state push cannot resurrect or drop a project. Dedicated tests cover multi-project parsing and recency ordering, cached versus live status, and the single-working-project auto-open rule.
- **Quota usage dashboard (Linux + Android)**: a new shared `额度统计` page charts locally sampled quota data as a multi-series line chart and a Codex/Magpie-style **53-week calendar heatmap**. The calendar is Monday-first, colours each day by its highest sampled quota usage (five levels, empty days left blank), supports horizontal scrolling on phones and shows a per-day tooltip. It collects Muse subscription/top-up usage, Hark daily/pool token meters, and Dot 5-hour/weekly rate limits where the running shell exposes them, persists up to 400 days in local storage, supports 7/14/30-day trend ranges, per-series legend toggles and history clearing. The page is reachable from the desktop sidebar, command palette, and the mobile home header; Android's native Hark bridge now exposes `/billing/summary` for the same view. Shared aggregation, calendar bucketing and provider parsers have dedicated tests.
- **Animated Android bot avatars**: the native fallback avatar now renders the full 26-shape, 11-colour `BotMark` character (gradient body, blinking eyes, working bob and orbit dots) instead of a static platform icon, matching the desktop `GrokBotMark` defaults for every bot.

### Fixed
- **Hark multi-account live monitoring**: every signed-in Hark account keeps a 30s background status watcher; up to 10 opened/working accounts are promoted to a 5s live pool and pinned there until their task completes. Switching away no longer stops the previous account's watcher, and Android now runs one independent poll loop per Hark account with at least 10 concurrent requests instead of waiting on four-account batches.
- **Hark working status dropped**: Hark sends narration as `{ line, lineArgs, visible, working, … }` objects; the previous parser only accepted strings, so real status lines were silently discarded. Both snapshot and incremental patches are now normalized, and status-only patches no longer erase the last visible line.
- **Android avatar placeholder dash**: Hark bots are stored with the placeholder emoji `-`; the native avatar used to draw that hyphen as text. The emoji branch is gone, so every bot shows its generated character and the working animation again.
- **Android agent interaction parity**: message sending, stop, new session, inline approvals, Hark project browsing and artifact downloads now go through the native bridge instead of the divergent Compose chat state machine.
- **Android post-pairing white screen**: the shared mobile shell now anchors to the real WebView bounds instead of `100vh`/`100dvh`; Android WebView can report those units as `0px`, which previously collapsed the workspace and left a blank screen after QR pairing.

## [0.11.0] - 2026-11-24

### Added
- **Android grouped bot list**: desktop groups and their collapsed state now survive QR/offline sync; group headers show bot counts and can be collapsed locally without changing the desktop sidebar.
- **Portable proxy nodes**: verified vless URIs are delivered natively to the phone, while desktop-local HTTP/SOCKS nodes are exposed through authenticated LAN SOCKS relay listeners; proxy credentials travel inside the one-time QR AES payload or the encrypted offline bundle and are stored in Android Keystore.
- **Android multi-protocol proxy + unused-node preference**: the bundled mihomo core accepts vless, HTTP and SOCKS5 nodes from sync/subscriptions, and the proxy group uses a fallback health check over an unused-first ordering to auto-select a working node.
- **Hark project list, working shortcuts and delete**: desktop and Android now show Hark projects in a recency-first list, surface every `working` project as a quick-switch entry, and allow deleting stuck project conversations from either client.
- **Native Android Hark direct mode**: the phone can list projects, read and send messages, poll working/unread status, delete projects and load Hark images directly against `app.hark.com` after QR sync; the desktop no longer needs to stay online for Hark.
- **Hark project state badges**: each project now distinguishes `working`, `unread`, `completed` and `not started`, so an idle project no longer looks identical whether it has never received a task or has just finished one.
- **Resume last Hark conversation**: an opt-in (default on) setting restores the last project chat on first open; with no history it opens the single working project, or the project page with a working list when several are active.

### Fixed
- **Hark false "已送达但没有回复"**: a still-working Hark project is no longer marked as an unanswered send after the reply poll times out; completion is re-detected from the status monitor and the full reply is reloaded when Hark finishes.
- **Hark status sync**: working/unread statuses now reach the Android project list continuously instead of only after the desktop project page is opened.
- **Android working state**: the phone bot list now receives adapter activity, so a running bot shows the pulsing working indicator and activity text instead of looking idle.
- **QR Hark session import**: pairing now carries Hark better-auth cookies (AES-256-GCM under the one-time QR key) so a paired phone can operate Hark directly without the desktop bridge.
- **App-only proxy kernel**: the phone now runs the bundled mihomo core as a local mixed-port proxy (`127.0.0.1:17890`) instead of a phone-wide VPN, so no routing loop or other-app leakage; all desktop proxy nodes (including assigned ones) are offered to the phone.
- **Mobile sync port stability**: the desktop sync server now uses a port outside mihomo's 18800-19999 proxy range, preventing a random fallback port that broke reconnects after desktop restart.
- **Android VPN LAN bridge**: when the phone proxy is enabled, private LAN/Tailscale addresses now bypass mihomo, so the authenticated desktop bridge is not routed through a remote proxy.
- **Hark images on Android**: Hark project image artifacts are downloaded through the desktop Hark session and sent to the phone as data URLs, so phone image bubbles no longer depend on `harkatt://` paths.

### Changed
- **Mobile sync pairing payload**: pairing and `.botark-sync` exports now optionally carry encrypted proxy nodes; older clients ignore the extra field.

## [0.10.3] - 2026-11-24

### Added
- **Hark project workspace**: Hark bots now open a project page first, listing the main conversation and every project, with search, a one-click "New project" composer, and native chat scoped to the selected project conversation.
- **Hark working-state avatar**: Hark conversation status is polled continuously; whenever any project is `working`, the account turns busy and the character avatar shows its working/loading state.
- **Linux completion notification**: when a Hark project leaves `working`, a Linux desktop notification ("Hark 已完成") names the project and opens it on click.

### Changed
- **Hark send routing**: outgoing messages use the selected project conversation id, while the main conversation keeps its server-side refresh and stale-id fallback.

## [0.10.2] - 2026-11-22

### Added
- **Per-account one-click proxy reassignment**: an "Assign an unused available proxy" button on the single-account proxy card probes the pool, drops dead nodes and binds one free, working proxy to that account immediately (with pool bookkeeping and hot-swapped session/WSS transport).

## [0.6.0] - 2026-11-18

### Changed
- **Rebranded to BotArk**: Official project, repository (`qybaihe/botark`), macOS signed & notarized `.dmg`/`.zip`, and Windows NSIS installer renamed to **BotArk** — with automatic local `userData` migration so existing accounts and sessions carry over seamlessly.
- **Flagship Documentation Overhaul**: Upgraded all 16 localized READMEs with visual Bento workflow galleries, inline platform icons, streamlined quick-start guides, and updated `1280×640` social preview cards.

## [0.5.1] - 2026-11-17

### Changed
- **Redesigned Flagship 3D App Icon ("The Living Nexus")**: Brand-new macOS continuous-curvature squircle `.icns` (10-layer Retina iconset) and Windows `1024×1024` installer icon crafted with dark anodized titanium, four refractive dichroic glass petals, and a sculpted 3D ceramic Bot core.
- **Refreshed Brand Assets & Documentation**: Updated README brand emblem, `1280×640` GitHub social preview card, 16-language README guides, and repository community health templates.

## [0.5.0] - 2026-11-16

### Added
- **Official Apple Developer ID Signed & Notarized macOS Builds**: Both `arm64` (Apple Silicon) and `x64` (Intel) `.dmg` & `.zip` installers open directly without Gatekeeper warnings and support 1-click in-app updates.
- **Grok Bot 1-Account → Multi-Bot Sidebar Sync**: Signing into or importing a single Grok Bot account automatically populates every agent and group room under that account as an individual Bot in the left sidebar. Create new bots on an existing account without re-authenticating.
- **Zero-Bounce Grok Sign-In & Universal Credential Import**: Keeps OAuth popups (Google, X, Apple, GitHub) inside the login partition, blocks external deep-link app hijacking, honors OS system proxies (e.g. Clash / Surge), supports **1-click default browser authorization**, and imports Access Tokens, Cookies, JSON, or API Keys directly.
- **Tailored Right-Side Workbench (`⌘I`)**: Product-specific panels for **Grok Bot**, **ChatGPT Dot**, **Meta Muse**, and **Hark** covering sessions, subagent tasks, memories, skills, schedules, cloud sandboxes, and file libraries.
- **Full-Screen Interactive Quick Guide**: Step-by-step visual walkthrough of the three-column layout, account import entry points, and right-side workbench.

## [0.4.0] - 2026-11-09

### Added
- Multi-platform workspace uniting **Meta Muse**, **Grok Bot**, **Hark**, and **ChatGPT Dot** in one Electron + React desktop client.
- Per-account isolated partitions, Keychain-encrypted token storage, and 1-to-1 HTTP / SOCKS5 proxy pool routing.
- Streaming chat with tool-call traces, interactive approvals, document canvas, and animated `GrokBotMark` avatars.
