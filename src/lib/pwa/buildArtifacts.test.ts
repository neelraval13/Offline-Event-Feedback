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

  it('ships no runtime dependency on another origin', () => {
    /*
     * XML namespaces and documentation links appear as string literals but are
     * never fetched. Anything else would be a network dependency in an app
     * whose whole point is not having one.
     */
    const allowed = new Set([
      'www.w3.org',
      'react.dev',
      'bit.ly',
      'tinyurl.com',
      'goo.gl',
      'developer.chrome.com',
      'developers.google.com',
      'github.com',
    ])

    const hosts = new Set<string>()
    for (const name of assets().filter((asset) => asset.endsWith('.js'))) {
      const source = readFileSync(join(DIST, 'assets', name), 'utf8')
      for (const match of source.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        hosts.add((match[1] ?? '').toLowerCase())
      }
    }

    expect([...hosts].filter((host) => !allowed.has(host))).toEqual([])
  })
})
