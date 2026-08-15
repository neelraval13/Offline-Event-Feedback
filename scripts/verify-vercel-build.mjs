import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/*
 * The check that would have caught the production outage.
 *
 * Every test in this repository called the Hono application directly, through a
 * bundler that resolves module specifiers generously. Production does not: it
 * runs the JavaScript that `vercel build` emits, under Node's ESM loader, and
 * that loader does no extension guessing at all. So a build could be green,
 * every test could pass, and `/api/health` could still answer:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/var/task/server/centralApp'
 *
 * because the emitted `import ... from '../server/centralApp'` had no `.js` on
 * it. The file was there. Node simply will not look for it under another name.
 *
 * This script checks the artifact rather than the source:
 *
 *   1. the function exists where the route table sends traffic
 *   2. every relative import inside it resolves to a file that is actually
 *      packaged, by the exact rules Node ESM uses
 *   3. the route table reaches the function for every public API path
 *   4. the built function imports and answers, in this Node process
 *
 * Step 4 is the one that matters most: it is the real artifact, loaded the real
 * way. Steps 1 to 3 exist so that a failure says which of them broke.
 *
 * Usage:
 *
 *   pnpm dlx vercel build      (or `vercel build`, if the CLI is installed)
 *   pnpm verify:vercel
 *
 * Requires no dependencies and never contacts Vercel, a database or a network.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUTPUT = join(ROOT, '.vercel', 'output')
const CONFIG = join(OUTPUT, 'config.json')

/** The public contract. Each of these must reach the central Hono router. */
const CONTRACT = [
  { method: 'GET', path: '/api/health' },
  { method: 'POST', path: '/api/v1/sync/enroll' },
  { method: 'POST', path: '/api/v1/sync/batch' },
  { method: 'GET', path: '/api/v1/reporting/overview' },
  { method: 'GET', path: '/api/v1/reporting/export/registrations' },
]

/* A database that cannot be reached, so nothing here can touch a real one. The
 * asserted responses are all produced before any query runs. */
const SAFE_ENV = {
  DATABASE_URL: 'postgres://verify:verify@127.0.0.1:1/unreachable',
  SYNC_ENROLLMENT_SECRET: 'verify-vercel-build-enrolment-secret',
  SYNC_ALLOWED_ORIGINS: '',
}

const problems = []
const notes = []

function fail(message) {
  problems.push(message)
}

function note(message) {
  notes.push(message)
}

if (!existsSync(CONFIG)) {
  console.error(
    'No Vercel build output found at .vercel/output.\n' +
      'Run `pnpm dlx vercel build` first; this script inspects what that produces.',
  )
  process.exit(2)
}

const config = JSON.parse(readFileSync(CONFIG, 'utf8'))

/* ------------------------------------------------------------------ *
 * 1. The route table reaches a function for every public API path
 * ------------------------------------------------------------------ */

/**
 * Resolves a path through the Build Output route table.
 *
 * Only the phases that decide whether a request reaches a function are walked:
 * a `continue` route adds headers and moves on, the `filesystem` handle is
 * where static files win, and everything after `error` or `miss` is a fallback
 * for requests that already failed.
 */
function resolveRoute(path) {
  let phase = 'initial'

  for (const route of config.routes ?? []) {
    if (typeof route.handle === 'string') {
      phase = route.handle
      continue
    }
    if (phase !== 'initial' && phase !== 'filesystem') {
      continue
    }

    const match = new RegExp(route.src).exec(path)
    if (match === null || route.continue === true) {
      continue
    }
    if (typeof route.dest === 'string') {
      const dest = route.dest.replace(/\$(\d)/g, (_, index) => match[Number(index)] ?? '')
      return { kind: 'function', dest }
    }
    if (route.status !== undefined) {
      return { kind: 'status', status: route.status }
    }
  }

  return { kind: 'static' }
}

const destinations = new Set()

for (const { path } of CONTRACT) {
  const outcome = resolveRoute(path)

  if (outcome.kind !== 'function') {
    fail(
      `route table does not send ${path} to a function: ` +
        (outcome.kind === 'status'
          ? `the platform answers ${outcome.status} itself`
          : 'it falls through to the static filesystem'),
    )
    continue
  }

  destinations.add(outcome.dest.split('?')[0])
  note(`route  ${path} -> ${outcome.dest}`)
}

if (destinations.size > 1) {
  fail(
    `the public API paths are split across ${destinations.size} functions ` +
      `(${[...destinations].join(', ')}); one central router was intended`,
  )
}

/* ------------------------------------------------------------------ *
 * 2. The function that routing names is actually packaged
 * ------------------------------------------------------------------ */

const [destination] = [...destinations]

if (destination === undefined) {
  console.error('FAILED: no API path reaches a function at all.\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

const funcDir = join(OUTPUT, 'functions', `${destination.replace(/^\//, '')}.func`)

if (!existsSync(funcDir)) {
  console.error(
    `FAILED: routing sends the API to ${destination}, but there is no ` +
      `function at ${relative(ROOT, funcDir)}.`,
  )
  process.exit(1)
}

const vcConfig = JSON.parse(readFileSync(join(funcDir, '.vc-config.json'), 'utf8'))
const handler = join(funcDir, vcConfig.handler)

if (!existsSync(handler)) {
  console.error(
    `FAILED: the function declares handler "${vcConfig.handler}", which is not in the artifact.`,
  )
  process.exit(1)
}

note(`handler  ${vcConfig.handler}  (${vcConfig.runtime})`)

/* ------------------------------------------------------------------ *
 * 3. Every relative import resolves, by Node ESM's rules
 * ------------------------------------------------------------------ */

/**
 * Whether the packaged function is loaded as ESM.
 *
 * This is the whole reason extensionless specifiers are fatal. Under CommonJS
 * `require('./app')` finds `app.js`; under ESM `import './app'` does not.
 */
const artifactPackage = existsSync(join(funcDir, 'package.json'))
  ? JSON.parse(readFileSync(join(funcDir, 'package.json'), 'utf8'))
  : {}
const isEsm = artifactPackage.type === 'module'

note(`module system  ${isEsm ? 'ESM ("type": "module")' : 'CommonJS'}`)

function* jsFiles(dir) {
  for (const entry of readdirSync(dir)) {
    // Dependencies are packaged by Vercel's tracer and resolve by their own
    // package metadata; what is checked here is the code this repository wrote.
    if (entry === 'node_modules') continue

    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* jsFiles(full)
    } else if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
      yield full
    }
  }
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*|\bexport\s*\*\s*from\s*|\bimport\()(['"])(\.\.?\/[^'"]+)\1/g

let checked = 0

for (const file of jsFiles(funcDir)) {
  const source = readFileSync(file, 'utf8')

  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[2]
    checked += 1

    const target = resolve(dirname(file), specifier)

    if (existsSync(target) && statSync(target).isFile()) {
      continue
    }

    // Say precisely what went wrong, because the two causes need different
    // fixes: a missing extension is a source change, a missing file is a
    // bundling change.
    const withJs = `${target}.js`
    const where = `${relative(funcDir, file)}: import '${specifier}'`

    if (isEsm && existsSync(withJs)) {
      fail(
        `${where} has no file extension. The file IS packaged as ` +
          `${relative(funcDir, withJs)}, but Node ESM does not search for it. ` +
          `Write the specifier as '${specifier}.js' in the TypeScript source.`,
      )
    } else if (existsSync(join(target, 'index.js'))) {
      fail(
        `${where} points at a directory. Node ESM does not resolve directory ` +
          `indexes; write '${specifier}/index.js'.`,
      )
    } else {
      fail(`${where} is not in the function artifact at all.`)
    }
  }
}

note(`relative imports checked  ${checked}`)

/* ------------------------------------------------------------------ *
 * 4. The artifact imports and answers
 * ------------------------------------------------------------------ */

if (problems.length === 0) {
  for (const [name, value] of Object.entries(SAFE_ENV)) {
    process.env[name] = value
  }

  let entry
  try {
    entry = await import(pathToFileURL(handler).href)
  } catch (error) {
    console.error('FAILED: the built function does not import under Node ESM.\n')
    console.error(`  ${error instanceof Error ? error.message : String(error)}`)
    console.error(
      '\nThis is exactly the production symptom: the function is invoked, and ' +
        'crashes before any request handling runs.',
    )
    process.exit(1)
  }

  const app = entry.default

  if (app === undefined || typeof app.fetch !== 'function') {
    fail('the function default export has no `fetch`, so Vercel cannot invoke it')
  } else {
    for (const { method, path } of CONTRACT) {
      let response
      try {
        response = await app.fetch(
          new Request(`https://verify.local${path}`, {
            method,
            ...(method === 'POST'
              ? { headers: { 'Content-Type': 'application/json' }, body: '{}' }
              : {}),
          }),
        )
      } catch (error) {
        fail(`${method} ${path} threw: ${error instanceof Error ? error.message : error}`)
        continue
      }

      // 404 is the failure being guarded against: it means the request reached
      // the function and the router did not recognise the path. Every other
      // status means the central app answered, which is all this proves.
      if (response.status === 404) {
        fail(`${method} ${path} returned 404 from the central router`)
      } else {
        note(`invoke  ${method} ${path} -> ${response.status}`)
      }
    }
  }
}

/* ------------------------------------------------------------------ */

if (problems.length > 0) {
  console.error('FAILED: the Vercel build output would not serve the API.\n')
  for (const problem of problems) {
    console.error(`  - ${problem}`)
  }
  process.exit(1)
}

for (const line of notes) {
  console.log(`  ${line}`)
}
console.log('\n✓ Vercel build output serves the API: routing, packaging and invocation')
