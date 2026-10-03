import { defineConfig } from 'vite'

export default defineConfig({
  // Deployed under /bomber/ on ajaira.bhaai.site.
  base: '/bomber/',
  server: {
    port: 5174,
    open: true,
    host: true,
  },
})
