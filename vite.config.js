import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.NODE_ENV !== 'production', // only in dev
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
})
