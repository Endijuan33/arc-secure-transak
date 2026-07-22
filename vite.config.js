import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.NODE_ENV !== 'production', // only in dev
    allowedHosts: [
            'sb-43myv046y4b5.vercel.run',
                ],
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
})
