import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { rendererAlias, rendererPlugins, rendererRoot } from './vite.shared.mts'

/**
 * Runs only the renderer in a regular browser (no Electron, no preload).
 * The renderer guards every preload API access, so it degrades gracefully.
 */
export default defineConfig({
  root: rendererRoot,
  resolve: { alias: rendererAlias },
  plugins: rendererPlugins(),
  server: { port: 5174, strictPort: false },
  // Relative asset URLs so the same bundle can be served from the Android
  // WebViewAssetLoader origin (https://appassets.androidplatform.net/assets/web).
  base: './',
  build: {
    outDir: resolve('dist/web'),
    emptyOutDir: true
  }
})
