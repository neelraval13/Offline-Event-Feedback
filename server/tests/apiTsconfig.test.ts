import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

/*
 * The hosted Vercel function build compiles `api/index.ts` and everything it
 * imports, and it does not use `server/tsconfig.json`.
 *
 * Vercel's function compiler resolves the tsconfig nearest to the entrypoint.
 * With no `api/tsconfig.json` it walked up to the root `tsconfig.json`, a
 * solution-style file that carries no `compilerOptions` at all, and compiled
 * the whole server tree on TypeScript's bare defaults: no `types: ["node"]`,
 * `strict` off. That produced fifteen diagnostics against code that
 * `pnpm server:typecheck` reported as clean, because the two compilers were
 * never reading the same settings.
 *
 * Nothing else in the repository fails when `api/tsconfig.json` is deleted or
 * edited: `tsc -b` does not read it and neither does `server:typecheck`. The
 * only signal is a hosted build nobody runs locally. That is what these tests
 * are for.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const API_TSCONFIG = join(REPO, 'api/tsconfig.json')
const SERVER_TSCONFIG = join(REPO, 'server/tsconfig.json')

/**
 * The options as the compiler will actually apply them, rather than as they
 * happen to be spelled: defaults filled in, casing normalised, `extends`
 * followed. Two configs agreeing here is the thing that matters.
 */
function effectiveOptions(configPath: string): ts.CompilerOptions {
  const read = ts.readConfigFile(configPath, (p) => readFileSync(p, 'utf8'))
  expect(read.error).toBeUndefined()

  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    dirname(configPath),
  )
  expect(parsed.errors).toEqual([])

  const options: Record<string, unknown> = { ...parsed.options }
  /*
   * Both are per-file bookkeeping rather than semantics: one names the project
   * that produced the options, the other an incremental cache path that only
   * the local `server:typecheck` has any use for.
   */
  delete options['configFilePath']
  delete options['tsBuildInfoFile']
  return options as ts.CompilerOptions
}

describe('api/tsconfig.json', () => {
  it('exists', () => {
    /*
     * Deleting it looks harmless. Every local gate still passes and the next
     * hosted build quietly loses `types: ["node"]` and every strictness flag.
     */
    expect(() => readFileSync(API_TSCONFIG, 'utf8')).not.toThrow()
  })

  it('compiles the server tree exactly as server:typecheck does', () => {
    expect(effectiveOptions(API_TSCONFIG)).toEqual(
      effectiveOptions(SERVER_TSCONFIG),
    )
  })

  it('states its options directly rather than extending another config', () => {
    /*
     * The duplication between this file and `server/tsconfig.json` is
     * deliberate and the obvious tidy-up breaks the build it exists to fix.
     *
     * Vercel's compiler honours an inherited `types` but not inherited
     * strictness, so an `extends` spelling silently returns `strict`,
     * `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` to their
     * defaults and brings back five diagnostics. Measured, not assumed: the
     * extends form was built and produced exactly those five.
     *
     * The test above is what keeps the duplicate honest.
     */
    const read = ts.readConfigFile(API_TSCONFIG, (p) => readFileSync(p, 'utf8'))
    const raw = read.config as { extends?: unknown; compilerOptions?: unknown }

    expect(raw.extends).toBeUndefined()
    expect(raw.compilerOptions).toBeTypeOf('object')
  })

  it('sees the whole tree the function entrypoint pulls in', () => {
    /*
     * `api/index.ts` is a thin mount. If `server/` and `shared/` were outside
     * the file set, the entrypoint would typecheck while the code doing the
     * work went unchecked.
     */
    const read = ts.readConfigFile(API_TSCONFIG, (p) => readFileSync(p, 'utf8'))
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      dirname(API_TSCONFIG),
    )

    const covered = (suffix: string) =>
      parsed.fileNames.some((name) => name.startsWith(join(REPO, suffix)))

    expect(covered('api/')).toBe(true)
    expect(covered('server/')).toBe(true)
    expect(covered('shared/')).toBe(true)
  })

  it('gives the server tree Node globals and full strictness', () => {
    /*
     * Named individually because these are the settings whose absence produced
     * the original diagnostics: `types` for `process`, `Buffer` and
     * `node:crypto`, and the strictness flags for the union narrowing and the
     * schema refinement.
     */
    const options = effectiveOptions(API_TSCONFIG)

    expect(options.types).toEqual(['node'])
    expect(options.strict).toBe(true)
    expect(options.noUncheckedIndexedAccess).toBe(true)
    expect(options.exactOptionalPropertyTypes).toBe(true)
  })
})
