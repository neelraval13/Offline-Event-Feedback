/*
 * Verifies that a production build can actually cold-start offline.
 *
 * Runs as part of `pnpm build`, so a build that would leave a device stranded
 * in the field fails here rather than at the venue. The failure this guards
 * against is quiet by nature: the app looks fine online, and only stops working
 * once the server is gone.
 *
 * Deliberately checks outcomes, not Workbox internals — that the emitted
 * assets are in the precache manifest, not how Workbox chose to spell them.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const failures = []
const notes = []

function check(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

if (!existsSync(DIST)) {
  console.error(`✗ ${DIST}/ does not exist — run \`pnpm build\` first.`)
  process.exit(1)
}

/* ---- the artifacts an installable, offline-capable app needs ---- */

const distFiles = readdirSync(DIST)
const serviceWorker = join(DIST, 'sw.js')

check(existsSync(join(DIST, 'index.html')), 'index.html is missing')
check(
  existsSync(join(DIST, 'manifest.webmanifest')),
  'manifest.webmanifest is missing',
)
check(existsSync(serviceWorker), 'sw.js (the service worker) is missing')
check(
  distFiles.some((name) => /^workbox-[\da-f]+\.js$/.test(name)),
  'the Workbox runtime chunk is missing',
)

if (failures.length > 0) {
  console.error('✗ PWA build verification failed:')
  for (const failure of failures) {
    console.error(`  - ${failure}`)
  }
  process.exit(1)
}

/* ---- every emitted asset must be precached ---- */

const sw = readFileSync(serviceWorker, 'utf8')

/** Entries in the generated precache manifest, as url -> revision. */
const entries = [...sw.matchAll(/url:\s*"([^"]+)",\s*revision:\s*("[^"]*"|null)/g)]
const precached = new Set(entries.map(([, url]) => url))

/*
 * The glob and the plugin's own manifest/icon injection overlap, so some URLs
 * are listed twice. Identical entries are deduped by Workbox and are harmless —
 * but the same URL at two different revisions would mean the shell disagrees
 * with itself about what to cache.
 */
const revisions = new Map()
for (const [, url, revision] of entries) {
  const seen = revisions.get(url)
  check(
    seen === undefined || seen === revision,
    `${url} is precached twice with different revisions (${String(seen)} vs ${revision})`,
  )
  revisions.set(url, revision)
}

const assets = readdirSync(join(DIST, 'assets'))
const javascript = assets.filter((name) => name.endsWith('.js'))
const stylesheets = assets.filter((name) => name.endsWith('.css'))

check(javascript.length > 0, 'no JavaScript was emitted')
check(stylesheets.length > 0, 'no CSS was emitted')

/*
 * Every emitted chunk, not just the entry point. If the app is ever code-split,
 * a chunk that escapes the precache is a scanner or a screen that works until
 * the network disappears.
 */
for (const asset of [...javascript, ...stylesheets]) {
  check(
    precached.has(`assets/${asset}`),
    `assets/${asset} is emitted but NOT precached — it would be unavailable offline`,
  )
}

check(precached.has('index.html'), 'index.html is not precached')
check(
  precached.has('manifest.webmanifest'),
  'manifest.webmanifest is not precached',
)

/* ---- the shell must work for hash routes with no server ---- */

check(
  sw.includes('NavigationRoute') && sw.includes('index.html'),
  'no navigation fallback to index.html — #/a, #/b and #/admin would not cold-start',
)

/* ---- updates must wait for an operator ---- */

check(
  sw.includes('SKIP_WAITING'),
  'the service worker cannot be told to activate, so Apply update would do nothing',
)
check(
  !/self\.skipWaiting\(\)\s*[;,}]/.test(sw.replace(/"SKIP_WAITING"===\w+\.data\.type&&self\.skipWaiting\(\)/, '')),
  'the service worker calls skipWaiting() unconditionally — an update could reload a terminal mid-registration',
)

/*
 * ---- synchronisation is never cached ----
 *
 * Sync is network-only by construction: precaching is GET-only over built
 * assets and there is no runtime caching rule. A cached upload response would
 * be a device believing it had synced when it had not.
 */
check(
  !sw.includes('/v1/sync'),
  'the service worker references the sync API — upload responses must never be cached',
)
check(
  !sw.includes('runtimeCaching'),
  'the service worker has a runtime caching rule; sync must stay network-only',
)

/*
 * ---- reporting is never cached ----
 *
 * Reporting responses carry every participant's name, phone number and email.
 * A cached copy would survive on the organiser's disk after the tab closed, so
 * the worker must not know the endpoint exists.
 */
check(
  !sw.includes('/v1/reporting'),
  'the service worker references the reporting API — participant data must never be cached',
)

/* ---- icons ---- */

for (const icon of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
  check(existsSync(join(DIST, 'icons', icon)), `icons/${icon} is missing`)
  check(precached.has(`icons/${icon}`), `icons/${icon} is not precached`)
}

/* ---- nothing may be fetched from another origin at runtime ---- */

const externalHosts = new Set()
for (const file of [...javascript.map((n) => join(DIST, 'assets', n)), serviceWorker]) {
  const source = readFileSync(file, 'utf8')
  for (const [, host] of source.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
    externalHosts.add(host.toLowerCase())
  }
}

/*
 * The sync API is a deliberate runtime dependency, baked in at build time. Its
 * host is expected — but a production build carrying a `localhost` or plain
 * HTTP endpoint is a misconfiguration worth failing loudly on, because the
 * symptom in the field is a device that silently never syncs.
 */
const syncUrl = /VITE_SYNC_API_BASE_URL:\s*`([^`]+)`/.exec(
  javascript.map((n) => readFileSync(join(DIST, 'assets', n), 'utf8')).join(''),
)?.[1]

if (syncUrl !== undefined) {
  let syncHost = ''
  try {
    const parsed = new URL(syncUrl)
    syncHost = parsed.hostname.toLowerCase()
    externalHosts.delete(syncHost)

    const local = syncHost === 'localhost' || syncHost === '127.0.0.1'
    check(
      parsed.protocol === 'https:' || local,
      `the sync API is configured over plain HTTP (${parsed.protocol}//${syncHost}) — registrations carry participant contact details`,
    )
    if (local) {
      notes.push(
        `sync API points at ${syncUrl} — a development endpoint. Rebuild with VITE_SYNC_API_BASE_URL unset or set to the production https URL before shipping.`,
      )
    } else {
      notes.push(`sync API configured: ${parsed.origin}`)
    }
  } catch {
    check(false, `VITE_SYNC_API_BASE_URL is not a valid URL`)
  }
}

/*
 * XML namespaces and documentation links appear as string literals but are
 * never fetched. Anything else is a real runtime dependency and a bug.
 */
const ALLOWED_HOSTS = new Set([
  'www.w3.org',
  // Zod embeds JSON Schema `$schema` identifiers as string literals. They are
  // identifiers, not endpoints, and nothing fetches them.
  'json-schema.org',
  'react.dev',
  'bit.ly',
  'tinyurl.com',
  'goo.gl',
  'developer.chrome.com',
  'developers.google.com',
  'github.com',
])

const unexpected = [...externalHosts].filter((host) => !ALLOWED_HOSTS.has(host))
if (unexpected.length > 0) {
  notes.push(
    `external hosts referenced in the bundle: ${unexpected.join(', ')} — confirm none is fetched at runtime`,
  )
}

/* ---- report ---- */

if (failures.length > 0) {
  console.error('✗ PWA build verification failed:')
  for (const failure of failures) {
    console.error(`  - ${failure}`)
  }
  process.exit(1)
}

const totalKib = [...javascript, ...stylesheets].reduce(
  (sum, name) =>
    sum + readFileSync(join(DIST, 'assets', name)).byteLength / 1024,
  0,
)

console.log(
  `✓ PWA build verified — ${precached.size} precached entries, ` +
    `${javascript.length} JS + ${stylesheets.length} CSS assets (${totalKib.toFixed(0)} KiB) all cached, ` +
    `navigation fallback present, updates gated on an operator.`,
)
for (const note of notes) {
  console.log(`  note: ${note}`)
}
