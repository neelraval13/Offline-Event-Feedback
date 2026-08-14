import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as {
  version: string
}

/*
 * Build identity.
 *
 * Injected at build time so a device can answer "what version am I running?"
 * with no network access: the operator reads it off the Admin screen and
 * compares it with another terminal. Deliberately just a version and a
 * timestamp: no commit hashes, no branch names, nothing about the machine that
 * produced the build.
 */
const BUILD_ID = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      /*
       * `generateSW`, not `injectManifest`.
       *
       * What this phase needs is deterministic precaching of the built app
       * shell, and that is exactly what the generated worker does. There is no
       * custom service-worker logic to write: no background sync, no runtime
       * API caching, no push. `injectManifest` would mean owning a
       * service-worker source file, more to get wrong, and nothing gained
       * until there is a server to sync with.
       */
      strategies: 'generateSW',

      /*
       * Prompt, never auto-update.
       *
       * A terminal in the middle of a registration must not be reloaded
       * because a new build appeared. The new worker downloads and waits; an
       * operator applies it from Admin when the desk is clear.
       */
      registerType: 'prompt',

      /* Registration is done deliberately from the client, in src/lib/pwa. */
      injectRegister: null,

      /*
       * No service worker in `pnpm dev`. A dev worker serving a stale shell is
       * a reliable way to lose an afternoon; PWA behaviour is tested against
       * `pnpm build && pnpm preview` instead.
       */
      devOptions: { enabled: false },

      workbox: {
        /*
         * Precache everything needed for a cold start. The ZXing scanner alone
         * is ~495 kB of the main bundle, and the default 2 MiB ceiling would
         * silently drop it, leaving a device that looks ready and then cannot
         * scan once the network is gone.
         */
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        /*
         * Fonts and images are in the glob for one reason: Point A and Point B
         * must render exactly as designed on a device that has been offline
         * since the morning. A heading that falls back to Impact because a font
         * was not precached is a visible failure at a desk.
         */
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,webmanifest,otf,ttf,woff,woff2,webp,jpg,jpeg,avif}',
        ],

        /*
         * Hash routing means every route is the same document. Serving the
         * precached entry point for any navigation is what lets `#/a`, `#/b`
         * and `#/admin` cold-start offline without a server rewrite rule.
         */
        navigateFallback: 'index.html',

        /* Take over promptly once the operator has applied an update. */
        clientsClaim: true,
        skipWaiting: false,

        /* Nothing is fetched from anywhere else, so nothing else is cached. */
        runtimeCaching: [],
      },

      /*
       * No `includeAssets`: the glob above already sweeps up the icons and the
       * web manifest, and listing them again only produces duplicate precache
       * entries.
       */
      manifest: {
        name: 'Offline Event Feedback',
        short_name: 'Event Feedback',
        description:
          'Offline registration and feedback capture for physical events.',
        display: 'standalone',
        orientation: 'portrait',
        /*
         * The neutral home screen, not a station. A device is not permanently
         * Point A or Point B, staff picks the station after launch, and
         * baking one in would make an installed terminal awkward to repurpose
         * mid-event.
         */
        start_url: './#/',
        scope: './',
        /* The campaign's own surfaces; see src/styles/tokens.css. */
        background_color: '#0b0d0e',
        theme_color: '#0b0d0e',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  // Relative base: the built app must be servable from any path (or a local
  // static host at the venue) without server-side configuration.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: {
    /*
     * One eager bundle for everything a station needs, deliberately.
     *
     * The ZXing scanner is ~495 kB of the total, and code-splitting it would be
     * the obvious move, except a lazily-fetched chunk needs the network at the
     * moment staff press "Start scanner". The service worker precaches every
     * emitted chunk, so splitting would now be safe, but a single bundle keeps
     * "is the scanner cached?" impossible to get wrong.
     *
     * Central reporting is the one exception (see `src/app/routes.tsx`): it
     * cannot function without the network anyway and never runs on a station
     * device, so it loads on demand.
     *
     * The limit is raised, not disabled, so further growth still gets flagged.
     */
    chunkSizeWarningLimit: 1000,
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
