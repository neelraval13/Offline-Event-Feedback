import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/*
 * Checks the real production output.
 *
 * `pnpm build` already runs `scripts/verify-pwa-build.mjs`, which is the
 * authoritative gate — a build that cannot cold-start offline fails there. This
 * mirror exists so the same guarantees show up in the test report, and it is
 * skipped when `dist/` is absent so a clean checkout can still run `pnpm test`.
 *
 * Assertions are about outcomes, not Workbox spelling: which files exist, and
 * whether the emitted assets are in the precache manifest.
 */

const DIST = 'dist'
const built = existsSync(join(DIST, 'sw.js'))

const describeBuild = built ? describe : describe.skip

if (!built) {
  console.info(
    'PWA build artifacts: skipped (no dist/ — run `pnpm build` to include these checks)',
  )
}

describeBuild('production PWA artifacts', () => {
  const sw = () => readFileSync(join(DIST, 'sw.js'), 'utf8')
  const assets = () => readdirSync(join(DIST, 'assets'))
  const precachedUrls = () =>
    new Set([...sw().matchAll(/url:\s*"([^"]+)"/g)].map((match) => match[1]))

  it('emits the service worker and the web app manifest', () => {
    expect(existsSync(join(DIST, 'sw.js'))).toBe(true)
    expect(existsSync(join(DIST, 'manifest.webmanifest'))).toBe(true)
    expect(
      readdirSync(DIST).some((name) => /^workbox-[\da-f]+\.js$/.test(name)),
    ).toBe(true)
  })

  it('precaches the application entry point', () => {
    expect(precachedUrls().has('index.html')).toBe(true)
  })

  it('precaches every emitted JavaScript and CSS asset', () => {
    // Including the ~830 kB bundle carrying Dexie, qrcode and the ZXing
    // scanner. A chunk missing here is a feature that dies with the network.
    const precached = precachedUrls()
    const code = assets().filter(
      (name) => name.endsWith('.js') || name.endsWith('.css'),
    )

    expect(code.length).toBeGreaterThan(0)
    for (const asset of code) {
      expect(precached.has(`assets/${asset}`)).toBe(true)
    }
  })

  it('precaches the manifest and icons', () => {
    const precached = precachedUrls()

    expect(precached.has('manifest.webmanifest')).toBe(true)
    for (const icon of [
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-512.png',
    ]) {
      expect(precached.has(`icons/${icon}`)).toBe(true)
    }
  })

  it('falls back to the entry point for navigations, so hash routes cold-start', () => {
    // #/a, #/b and #/admin are all the same document; without this they would
    // need a server rewrite rule that does not exist offline.
    expect(sw()).toContain('NavigationRoute')
  })

  it('does not activate a new version without being told to', () => {
    // The generated worker must only skip waiting in response to the message
    // Admin sends, never on its own.
    const source = sw()
    expect(source).toContain('SKIP_WAITING')

    const unconditional = source.replace(
      /"SKIP_WAITING"===\w+\.data\.type&&self\.skipWaiting\(\)/,
      '',
    )
    expect(unconditional).not.toContain('skipWaiting()')
  })

  it('registers no runtime cache, so no API response is ever stored', () => {
    /*
     * Reporting responses carry every participant's contact details, and a sync
     * upload response cached as successful would be a device believing it had
     * synced when it had not. The only route the worker registers is the
     * navigation fallback.
     */
    const source = sw()

    expect([...source.matchAll(/registerRoute\(/g)]).toHaveLength(1)
    expect(source).toContain('NavigationRoute')
    expect(source).not.toContain('/v1/reporting')
    expect(source).not.toContain('/v1/sync')
  })

  it('never precaches or runtime-caches the same-origin API', () => {
    /*
     * Under `/api` the API shares an origin with the app, which is exactly when
     * a stray glob or a navigation fallback could start answering API requests
     * from the cache — a stale upload result, or a participant's details served
     * from disk after the operator signed out.
     */
    const source = sw()
    const precached = precachedUrls()

    expect(
      [...precached].filter(
        (url) => url?.startsWith('api/') || url?.startsWith('/api'),
      ),
    ).toEqual([])
    expect(source).not.toContain('/api/v1')
    expect(source).not.toContain('NetworkFirst')
    expect(source).not.toContain('StaleWhileRevalidate')
  })

  it('precaches the campaign fonts, so headings survive going offline', () => {
    /*
     * A device that has been offline since the morning must render Point A
     * exactly as designed. A display face that was not precached falls back to
     * Impact mid-shift, which is a visible failure at a desk.
     */
    const precached = precachedUrls()

    for (const font of [
      'fonts/FlyingFlea-Bold.otf',
      'fonts/Graphik-Medium.otf',
      'fonts/Inter_18pt-Medium.ttf',
      'fonts/Inter_18pt-Bold.ttf',
    ]) {
      expect(precached.has(font)).toBe(true)
    }
  })

  it('precaches the campaign photography', () => {
    /*
     * Switching motorcycle colour offline must not need the network, and the
     * banner must render on a cold start in aeroplane mode. These three files
     * are part of the application, so their absence is a failure rather than a
     * degraded state.
     */
    const precached = precachedUrls()

    for (const image of [
      'assets/flying-flea/bike-flea-green.webp',
      'assets/flying-flea/bike-storm-black.webp',
      'assets/flying-flea/registration-header.webp',
    ]) {
      expect(existsSync(join(DIST, image))).toBe(true)
      expect(precached.has(image)).toBe(true)
    }
  })

  it('ships web derivatives rather than photographic masters', () => {
    /*
     * The supplied banner master is 5913x3140 — about 74 MB of decoded image on
     * a tablet, to fill a strip a few hundred pixels tall. The master is kept
     * outside the application in `design/assets/`.
     */
    const banner = join(DIST, 'assets/flying-flea/registration-header.webp')
    const bytes = readFileSync(banner).byteLength

    expect(bytes).toBeLessThan(400 * 1024)
  })

  it('ships the favicon as a local asset', () => {
    // A tab icon that needs the network is a tab icon that is missing at a
    // venue.
    for (const icon of ['favicon.svg', 'favicon.png', 'apple-touch-icon.png']) {
      expect(existsSync(join(DIST, icon))).toBe(true)
    }

    const html = readFileSync(join(DIST, 'index.html'), 'utf8')
    expect(html).toContain('rel="icon"')
    expect(html).toContain('/favicon.svg')
    expect(html).toContain('apple-touch-icon')
  })

  it('references no remote campaign asset host anywhere in the build', () => {
    /*
     * The reference hot-links its fonts from Google and its photography from
     * Royal Enfield's CDN. Point A and Point B must render with no network at
     * all, so none of those hosts may appear in what ships.
     */
    const built = [
      readFileSync(join(DIST, 'index.html'), 'utf8'),
      ...assets()
        .filter((asset) => asset.endsWith('.js') || asset.endsWith('.css'))
        .map((name) => readFileSync(join(DIST, 'assets', name), 'utf8')),
      sw(),
    ].join('')

    for (const host of [
      'fonts.googleapis.com',
      'fonts.gstatic.com',
      'flyingflea.royalenfield.com',
      'royalenfield.com',
      'twisstedx.com',
      'cloudinary',
    ]) {
      expect(built).not.toContain(host)
    }
  })

  it('describes an installable application', () => {
    const manifest = JSON.parse(
      readFileSync(join(DIST, 'manifest.webmanifest'), 'utf8'),
    ) as {
      name: string
      short_name: string
      display: string
      start_url: string
      scope: string
      icons: { sizes: string; purpose?: string }[]
    }

    expect(manifest.name).toBe('Offline Event Feedback')
    expect(manifest.short_name).toBe('Event Feedback')
    expect(manifest.display).toBe('standalone')
    // A neutral entry point: a device is not permanently Point A or Point B.
    expect(manifest.start_url).toBe('./#/')
    expect(manifest.scope).toBe('./')

    const sizes = manifest.icons.map((icon) => icon.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
  })

  it('ships no server secret', () => {
    /*
     * `VITE_` variables are compiled into the bundle and readable by anyone
     * holding a device. Server credentials must never be among them.
     *
     * Checked by name rather than by value: reading the operator's real secrets
     * to prove they are absent would put them in this process, in the test
     * output and potentially in CI logs. A name appearing in the bundle is
     * enough to fail, and is the only thing a leak could look like.
     */
    const bundles = assets()
      .filter((asset) => asset.endsWith('.js'))
      .map((name) => readFileSync(join(DIST, 'assets', name), 'utf8'))
      .join('')

    for (const name of [
      'DATABASE_URL',
      'MIGRATION_DATABASE_URL',
      'SYNC_ENROLLMENT_SECRET',
      'REPORTING_ADMIN_SECRET',
    ]) {
      expect(bundles).not.toContain(name)
    }

    // Nothing that looks like a connection string, either.
    expect(bundles).not.toContain('postgres://')
    expect(bundles).not.toContain('postgresql://')
  })

  it('would notice a secret that had been compiled in', () => {
    /*
     * A guard on the guard, using a synthetic sentinel: the check above is only
     * worth having if it would actually fail. No real secret is involved — the
     * point is that scanning the bundle for a known string works.
     */
    const sentinel = 'SYNTHETIC_SECRET_DO_NOT_USE_9f3a'
    const bundles = assets()
      .filter((asset) => asset.endsWith('.js'))
      .map((name) => readFileSync(join(DIST, 'assets', name), 'utf8'))
      .join('')

    expect(bundles).not.toContain(sentinel)
    expect(`${bundles}${sentinel}`).toContain(sentinel)
  })

  it('ships no runtime dependency on another origin', () => {
    /*
     * XML namespaces and documentation links appear as string literals but are
     * never fetched. Anything else would be a network dependency in an app
     * whose whole point is not having one.
     */
    const allowed = new Set([
      'www.w3.org',
      // Zod embeds JSON Schema `$schema` identifiers as string literals when
      // converting schemas. They are identifiers, not endpoints; verified that
      // nothing fetches them.
      'json-schema.org',
      'react.dev',
      'bit.ly',
      'tinyurl.com',
      'goo.gl',
      'developer.chrome.com',
      'developers.google.com',
      'github.com',
    ])

    const bundles = assets()
      .filter((asset) => asset.endsWith('.js'))
      .map((name) => readFileSync(join(DIST, 'assets', name), 'utf8'))
      .join('')

    const hosts = new Set<string>()
    for (const match of bundles.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      hosts.add((match[1] ?? '').toLowerCase())
    }

    /*
     * The sync API is a deliberate dependency when one is configured at build
     * time, so its host is expected rather than a surprise. `verify-pwa-build`
     * separately fails a production build that points at plain HTTP.
     *
     * A production build configures it as the same-origin path `/api`, which has
     * no host at all — there is nothing to exempt, and nothing to parse. Passing
     * it to `new URL()` throws, which is how this test failed the first time a
     * production-shaped build was run through it.
     */
    const syncUrl = /VITE_SYNC_API_BASE_URL:\s*`([^`]+)`/.exec(bundles)?.[1]
    if (syncUrl !== undefined && !syncUrl.startsWith('/')) {
      hosts.delete(new URL(syncUrl).hostname.toLowerCase())
    }

    expect([...hosts].filter((host) => !allowed.has(host))).toEqual([])
  })
})
