# Changelog

All notable changes to **BotArk** (formerly BotHub) are documented in this file.

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
