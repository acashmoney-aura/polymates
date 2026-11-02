import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Served from the poly.floatingkeys.com custom domain, so the app lives at the root.
  base: '/',
  plugins: [react()],
})
