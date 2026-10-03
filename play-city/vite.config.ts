import { defineConfig } from 'vite'
import { createMultiplayer } from './server/net.mjs'

export default defineConfig({
  // Top-level await (the garage gates game boot in main.ts) needs ES2022.
  build: {
    target: 'es2022',
  },
  server: {
    port: 5173,
    open: true,
    // Bind 0.0.0.0 so friends on the LAN can drive the same city. Vite prints the
    // network URL on boot.
    host: true,
  },
  plugins: [createMultiplayer()],
})
