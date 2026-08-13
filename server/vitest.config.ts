import { defineConfig } from 'vitest/config'

/*
 * Server tests run in Node, not jsdom: this code never sees a browser, and the
 * crypto it uses is Node's.
 *
 * Scoped to `server/` so the two suites stay separate commands with separate
 * environments — the client suite needs jsdom and a fake IndexedDB, neither of
 * which means anything here.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['server/**/*.test.ts'],
  },
})
