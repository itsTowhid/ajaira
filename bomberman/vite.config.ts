import { defineConfig } from 'vite'
import { createBomberRelay } from './server/net.mjs'

export default defineConfig({
  server: {
    port: 5174,
    open: true,
    host: true,
  },
  plugins: [createBomberRelay()],
})
