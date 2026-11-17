import react from '@vitejs/plugin-react'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// public/media holds store art for the browser demo only (fetched by scripts/fetch-media.mjs,
// not in the repository); the desktop app never shows it, so a build leaves it out.
const dropDemoMedia = (): Plugin => {
  let outDir = 'dist'
  return {
    name: 'drop-demo-media',
    apply: 'build',
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir) },
    closeBundle() { rmSync(path.join(outDir, 'media'), { recursive: true, force: true }) },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dropDemoMedia()],
  clearScreen: false,
  server: {
    // this machine only (not the local network)
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    // Rust build output changes constantly and is not part of the web app
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
