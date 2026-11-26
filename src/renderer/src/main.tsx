import '@fontsource-variable/inter'
import './styles/globals.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerBuiltInAdapters } from '@adapters/index'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { isAndroidShell, startAndroidBridge } from './lib/androidBridge'
import MobileApp from './mobile/MobileApp'
import App from './App'

// Adapters must be registered before the store talks to them.
registerBuiltInAdapters()

// The Android WebView hosts this same bundle. Hydrate the store from the
// native snapshot before React mounts.
const androidShell = isAndroidShell()
if (androidShell) startAndroidBridge()

// Files dropped outside a drop zone must not navigate away from the app.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (event) => event.preventDefault())
}

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      {androidShell ? <MobileApp /> : <App />}
    </ErrorBoundary>
  </StrictMode>
)
