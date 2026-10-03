import { defineConfig } from 'vite'
import { createBomberRelay } from './server/net.mjs'

export default defineConfig({
  // Deployed under /bomber/ on ajaira.bhaai.site (play-city owns the root /api/).
  base: '/bomber/',
  server: {
    port: 5174,
    open: true,
    host: true,
  },
  plugins: [createBomberRelay()],
})
