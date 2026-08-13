import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base: the built app must be servable from any path (or a local
  // static host at the venue) without server-side configuration.
  base: './',
  build: {
    /*
     * One eager bundle, deliberately.
     *
     * The ZXing scanner is ~495 kB of the total, and code-splitting it would be
     * the obvious move — except a lazily-fetched chunk needs the network at the
     * moment staff press "Start scanner", which is exactly when the device is
     * expected to be offline. A single larger bundle that is wholly present
     * after the initial load is the safer trade for this deployment.
     *
     * Revisit once the offline shell lands: a service worker precaches every
     * chunk, and splitting becomes free. The limit is raised, not disabled, so
     * further growth still gets flagged.
     */
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    // The public code and participant ID suites generate 10,000+ values each.
    testTimeout: 30_000,
  },
})
