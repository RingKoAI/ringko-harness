import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { sharedPort } from '../client/src/local.ts'

const workspace = fileURLToPath(new URL('../..', import.meta.url))
const api = process.env.RINGKO_API ?? `http://127.0.0.1:${sharedPort(workspace)}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // When the page is served through the app server (dev proxy), the HMR
    // client must still reach Vite directly.
    hmr: { clientPort: 5173 },
    proxy: {
      '/api': api,
    },
  },
})
