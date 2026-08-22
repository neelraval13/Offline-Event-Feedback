import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTES } from '@/app/routes'

/*
 * The concept is a prototype, and this is what keeps it one.
 *
 * A design prototype that imports the real registration path stops being a
 * prototype the moment somebody wires a button up "just to see it work", and
 * the first sign of that is a record in IndexedDB that no operator created.
 * These tests make the isolation a property of the build rather than of
 * everybody remembering.
 *
 * They also pin the two route facts the concept depends on: that it did not
 * replace the production screen, and that it is not reachable from a station
 * tablet's navigation.
 */

const CONCEPT_DIR = 'src/features/concept/point-a'

/** Every source file in the concept, with its imports. */
function conceptSources(): { name: string; source: string }[] {
  return readdirSync(CONCEPT_DIR)
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.test.ts'))
    .map((file) => ({
      name: file,
      source: readFileSync(join(CONCEPT_DIR, file), 'utf8'),
    }))
}

/*
 * Modules a visual prototype has no business reaching. Storage and sync are
 * obvious; `useRegistrationTerminal` is on the list because it is the one
 * import that would make every other one reachable in a single line.
 */
const FORBIDDEN = [
  'lib/storage',
  'lib/sync',
  'lib/backup',
  'lib/pwa',
  'lib/print',
  'lib/identity',
  'useRegistrationTerminal',
  'registration/validation',
  'eventStamp',
]

describe('the Point A concept', () => {
  it('cannot reach storage, sync, printing or the registration path', () => {
    for (const { name, source } of conceptSources()) {
      const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
        (match) => match[1] as string,
      )

      for (const specifier of imports) {
        for (const forbidden of FORBIDDEN) {
          expect(
            specifier.includes(forbidden),
            `${name} imports ${specifier}, which a visual prototype must not touch`,
          ).toBe(false)
        }
      }
    }
  })

  it('reads campaign data and the QR renderer, and nothing else stateful', () => {
    /*
     * The two deliberate exceptions, both pure reads. Campaign configuration is
     * the source of the real vehicle, colour and gender labels, and §21 asks
     * for them rather than for invented placeholders. `renderQrSvg` is a pure
     * payload-to-SVG function, which is what lets the sticker preview show the
     * real symbol density instead of a grey square.
     */
    const all = conceptSources()
      .map((file) => file.source)
      .join('\n')

    expect(all).toContain('flying-flea/config')
    expect(all).toContain('lib/qr/qrCode')

    /*
     * The payload is invented rather than built by the real contract, so the
     * symbol on screen is the right shape and encodes nothing a scanner at
     * Point B could resolve. Checked against what is imported, not against the
     * file text: the comment in `fixtures.ts` names the function it avoids.
     */
    const imported = conceptSources().flatMap(({ source }) =>
      [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap((match) =>
        (match[1] as string).split(',').map((name) => name.trim()),
      ),
    )

    expect(imported).not.toContain('qrPayloadForRegistration')
    expect(imported).not.toContain('createRegistration')
    expect(imported).toContain('renderQrSvg')
  })

  it('did not replace the production registration screen', () => {
    const pointA = ROUTES.find((route) => route.path === '/a')

    expect(pointA).toBeDefined()
    expect(pointA?.title).toBe('Point A: Registration')
    /*
     * Point A took minimal chrome in Phase 3, when the concept was approved and
     * implemented. What still matters here is that it is a route of its own,
     * listed in navigation, rendering the real terminal, and that the concept
     * did not become it.
     */
    expect(pointA?.showInNav).toBe(true)
    expect(pointA?.path).not.toBe('/concept/point-a')
  })

  it('is unlisted, minimal-chrome and on its own path', () => {
    const concept = ROUTES.find((route) => route.path === '/concept/point-a')

    expect(concept).toBeDefined()
    expect(concept?.showInNav).toBe(false)
    expect(concept?.chrome).toBe('minimal')
    expect(concept?.context).toBe('Point A · Registration')
  })

  it('shows no participant names in the reprint recovery list', () => {
    /*
     * A privacy property, not a layout one: a screen on a desk facing a queue
     * should not carry the last eight people's names, and nothing about
     * reprinting a label needs one. The fixture has no name field at all, which
     * is the strongest form of this guarantee.
     */
    const fixtures = readFileSync(join(CONCEPT_DIR, 'fixtures.ts'), 'utf8')
    const recent = /CONCEPT_RECENT[\s\S]*?\n\]/.exec(fixtures)?.[0] ?? ''

    expect(recent).toContain('code')
    expect(recent).toContain('time')
    expect(recent).not.toMatch(/\bname\b/)
  })
})
