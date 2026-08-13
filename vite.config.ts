import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base: the built app must be servable from any path (or a local
  // static host at the venue) without server-side configuration.
  base: './',
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
