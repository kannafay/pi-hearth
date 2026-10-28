import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  clearScreen: false,
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        tray: fileURLToPath(new URL('./tray.html', import.meta.url)),
      },
    },
  },
  server: {
    host: host || '127.0.0.1',
    port: 1420,
    strictPort: true,
    // Transform the deferred workspace before the native WebView requests it.
    warmup: { clientFiles: ['./src/main.tsx', './src/index.css'] },
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    // Test runs leave large fixture trees here; they are not frontend source.
    watch: { ignored: ['**/src-tauri/**', '**/work/**'] },
  },
})
