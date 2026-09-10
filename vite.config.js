import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { resolve } from 'path'

// Use import.meta.dirname for Vite 8+ native config loader compatibility
const rootDir = import.meta.dirname

/**
 * Vite plugin: After build, scans dist/assets and injects
 * all hashed asset filenames into public/sw.js → dist/sw.js
 * so the Service Worker can pre-cache ALL assets for full offline support.
 */
function pwaOfflinePlugin() {
  return {
    name: 'pwa-offline-sw',
    apply: 'build',
    closeBundle() {
      const distDir = resolve(rootDir, 'dist')
      const assetsDir = resolve(distDir, 'assets')
      const swSrc = resolve(rootDir, 'public', 'sw.js')
      const swDest = resolve(distDir, 'sw.js')

      if (!existsSync(assetsDir)) return

      // Collect all built asset filenames (JS, CSS, fonts, wasm)
      const assetFiles = readdirSync(assetsDir)
        .filter(f =>
          f.endsWith('.js') ||
          f.endsWith('.css') ||
          f.endsWith('.woff2') ||
          f.endsWith('.woff') ||
          f.endsWith('.wasm')
        )
        .map(f => `/assets/${f}`)

      // Read the SW template from public/sw.js
      let swContent = readFileSync(swSrc, 'utf-8')

      // Inject the dynamic asset list replacing the placeholder
      const dynamicAssetsJson = JSON.stringify(assetFiles, null, 2)
      swContent = swContent.replace(
        /\/\/ \[INJECT_DYNAMIC_ASSETS\]([\s\S]*?)\/\/ \[END_INJECT_DYNAMIC_ASSETS\]/,
        `// [INJECT_DYNAMIC_ASSETS]\nconst DYNAMIC_ASSETS = ${dynamicAssetsJson};\n// [END_INJECT_DYNAMIC_ASSETS]`
      )

      writeFileSync(swDest, swContent, 'utf-8')
      console.log(`[pwa-offline-sw] ✅ Injected ${assetFiles.length} assets into dist/sw.js`)
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pwaOfflinePlugin()],
})
