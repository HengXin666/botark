import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { attachWebViewManager, registerWebViewIpc } from './webViewIpc'
import { attachMuseSessionManager, disposeAllMuseManagers, registerMuseIpc } from './muse/museIpc'
import { registerUpdaterIpc, startAutoUpdater } from './updater'
import { registerGrokIpc } from './grok/grokIpc'
import { stopGrokAccountWatch } from './grok/grokWatchManager'
import { registerHarkIpc } from './hark/harkIpc'
import { cancelHarkWatch } from './hark/harkClient'
import { registerDotIpc } from './dot/dotIpc'
import { closeCelsiusWatcher } from './dot/dotClient'
import { registerHermesIpc } from './hermes/hermesIpc'
import { cancelAllHermesRuns } from './hermes/hermesClient'
import { registerAntigravityIpc } from './antigravity/antigravityIpc'
import { cancelAllAntigravityRuns } from './antigravity/antigravityClient'
import { registerMobileSyncIpc, stopMobileSyncServer } from './mobileSync/mobileSyncIpc'
import { applyAllStoredProxies, lookupProxyCredentials } from './muse/accountProxy'
import { hardenVaultFilePermissions, registerVaultIpc } from './securityVault'

app.setName('BotArk')
app.setPath('userData', join(app.getPath('appData'), 'botark'))

const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'
let mainWindow: BrowserWindow | null = null
let quitting = false

// Linux compositor/GPU tuning. Electron chooses X11/Wayland before this module
// runs; use ELECTRON_OZONE_PLATFORM_HINT=x11|wayland to override it.
if (isLinux) {
  const waylandSession =
    process.env['XDG_SESSION_TYPE'] === 'wayland' || Boolean(process.env['WAYLAND_DISPLAY'])
  if (waylandSession) {
    app.commandLine.appendSwitch('enable-wayland-ime')
    app.commandLine.appendSwitch('wayland-text-input-version', '3')
  }
  // Rasterize on the GPU and avoid a CPU copy for full-screen surfaces.
  app.commandLine.appendSwitch('enable-gpu-rasterization')
  app.commandLine.appendSwitch('enable-zero-copy')
  // Opt-in VA-API: safe on Mesa, but some proprietary drivers still crash.
  if (process.env['BOTARK_LINUX_VAAPI'] === '1') {
    app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder')
  }
}

// Seamless upgrade from legacy "bothub" userData directory: if an existing user
// already has accounts/sessions in Application Support/bothub and no new botark
// directory yet, preserve their exact userData directory automatically.
try {
  const appData = app.getPath('appData')
  const newUserData = join(appData, 'botark')
  const legacyUserData = join(appData, 'bothub')
  if (!existsSync(newUserData) && existsSync(legacyUserData)) {
    app.setPath('userData', legacyUserData)
  }
} catch {
  /* ignore */
}

// Two instances share userData and race on every JSON store and on
// Chromium's profile; hand the second launch over to the first.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    if (Array.isArray(argv) && argv.includes('--open-grok-login')) {
      void mainWindow.webContents
        .executeJavaScript("window.dispatchEvent(new CustomEvent('bothub:open-grok-login'))")
        .catch(() => undefined)
    }
  })
}

// A stray rejection or transient socket error in a timer/proxy/IPC handler
// should be logged cleanly instead of crashing the whole desktop workspace.
process.on('unhandledRejection', (reason) => {
  const text = reason instanceof Error ? `${reason.name}: ${reason.message}` : typeof reason
  console.error('[bothub] unhandled rejection:', text.slice(0, 300))
})
process.on('uncaughtException', (error) => {
  console.error('[bothub] uncaught exception:', `${error.name}: ${error.message}`.slice(0, 300))
})

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 620,
    show: false,
    title: 'BotArk',
    backgroundColor: '#f7f7f8',
    autoHideMenuBar: true,
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 28 } } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Embedded platform web sessions (hidden until the renderer attaches one).
  const views = attachWebViewManager(win)
  attachMuseSessionManager(win, views)

  win.once('ready-to-show', () => win.show())

  // macOS: the red button hides the window instead of destroying it. A
  // re-created window used to start a second Muse session manager while the
  // old one kept its timers and gateways running (one leak per reopen).
  win.on('close', (event) => {
    if (isMac && !quitting) {
      event.preventDefault()
      // Hiding a fullscreen window leaves an empty black Space behind.
      if (win.isFullScreen()) {
        win.once('leave-full-screen', () => win.hide())
        win.setFullScreen(false)
      } else {
        win.hide()
      }
    }
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // Never open new Electron windows from the renderer; hand http(s) links to the OS.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // The app is a single page: block navigations (e.g. a file dropped onto the
  // window) that would replace the UI. Reloads are not affected.
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  // Self-heal if Chromium's renderer process crashes or runs out of memory.
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[bothub] renderer gone:', details.reason, 'exitCode=', details.exitCode)
    if (!quitting && !win.isDestroyed() && details.reason !== 'clean-exit') {
      setTimeout(() => {
        if (!quitting && !win.isDestroyed()) win.webContents.reload()
      }, 600)
    }
  })
  win.on('unresponsive', () => {
    console.warn('[bothub] main window became unresponsive')
  })

  const wantGrokLogin = process.argv.includes('--open-grok-login')
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    const targetUrl = wantGrokLogin
      ? `${devUrl}${devUrl.includes('?') ? '&' : '?'}openGrokLogin=1`
      : devUrl
    void win.loadURL(targetUrl)
  } else {
    void win.loadFile(
      join(__dirname, '../renderer/index.html'),
      wantGrokLogin ? { query: { openGrokLogin: '1' } } : undefined
    )
  }

  return win
}

app.on('before-quit', () => {
  quitting = true
  stopGrokAccountWatch('*')
  closeCelsiusWatcher('*')
  cancelHarkWatch('*')
  cancelAllHermesRuns('*')
  cancelAllAntigravityRuns('*')
  void stopMobileSyncServer()
  disposeAllMuseManagers()
})

app.on('login', (event, _webContents, _request, authInfo, callback) => {
  if (!authInfo.isProxy) return
  const cred = lookupProxyCredentials(authInfo.host || '', Number(authInfo.port) || 0)
  if (cred) { event.preventDefault(); callback(cred.username, cred.password); return }
  // Unmatched proxy auth must not leak credentials or fall open.
  event.preventDefault()
  callback('', '')
})

app.whenReady().then(async () => {
  if (!gotLock) return
  hardenVaultFilePermissions()
  // Before any partition loads: otherwise the first requests go direct.
  await Promise.race([applyAllStoredProxies(), new Promise((r) => setTimeout(r, 5_000))])
  registerWebViewIpc()
  registerMuseIpc()
  registerUpdaterIpc()
  registerGrokIpc()
  registerHarkIpc()
  registerDotIpc()
  registerHermesIpc()
  registerAntigravityIpc()
  registerMobileSyncIpc()
  registerVaultIpc()
  mainWindow = createMainWindow()
  startAutoUpdater()

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
    else mainWindow = createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
