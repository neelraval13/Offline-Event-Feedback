import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveOperationalStatus } from './OperationalStatus'
import { STATUS, describeStatus, type StatusKey } from './status'

/*
 * The V2 foundation, checked as configuration.
 *
 * jsdom lays nothing out, so nothing here asserts how anything looks. What it
 * asserts is the class of mistake that is invisible in review and expensive in
 * the field, which is the same standard `src/styles/responsive.test.ts` and
 * `src/styles/typography.test.ts` already hold the V1 stylesheet to.
 *
 * Two of these guard defects that were actually made and fixed while building
 * this phase, and would otherwise have been reintroduced silently. Both are
 * marked below.
 */

const UI_DIR = 'src/components/ui'
const DESIGN_SYSTEM_DIR = 'src/components/design-system'

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every primitive, as source. */
function primitives(): { name: string; source: string }[] {
  return readdirSync(UI_DIR)
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => ({ name: file, source: read(join(UI_DIR, file)) }))
}

describe('the status vocabulary', () => {
  it('never communicates a state with colour alone', () => {
    /*
     * The rule the whole status system rests on. Around one man in twelve has
     * some form of colour vision deficiency, these screens are read outdoors
     * on tablets in daylight that flattens a dark interface, and operators
     * glance rather than read. Every state therefore carries an icon and a
     * word as well as a tone.
     */
    for (const [key, descriptor] of Object.entries(STATUS)) {
      expect(descriptor.icon, `${key} has no icon`).toBeDefined()
      expect(descriptor.label.length, `${key} has no label`).toBeGreaterThan(0)
      expect(descriptor.tone, `${key} has no tone`).toBeDefined()
    }
  })

  it('gives states that mean opposite things different tones', () => {
    // `offline-ready` and `offline-failed` are the two an operator acts on
    // before leaving for a venue, and confusing them costs an event's records.
    expect(STATUS['offline-ready'].tone).not.toBe(STATUS['offline-failed'].tone)
    expect(STATUS.synced.tone).not.toBe(STATUS['sync-error'].tone)
  })

  it('treats being offline as information, not as a failure', () => {
    /*
     * The product's defining property is that it keeps working without a
     * network. Colouring that red would tell an operator something is wrong
     * several hundred times a day until they stopped reading status colours at
     * all.
     */
    expect(STATUS.offline.tone).toBe('info')
    expect(STATUS.offline.tone).not.toBe('danger')
    // Not being enrolled is likewise a normal way to run a station device.
    expect(STATUS['not-enrolled'].tone).not.toBe('danger')
  })

  it('spins only the states that resolve on their own', () => {
    expect(STATUS.syncing.inProgress).toBe(true)
    expect(STATUS['offline-preparing'].inProgress).toBe(true)
    expect(STATUS.synced.inProgress).toBeUndefined()
    expect(STATUS['sync-error'].inProgress).toBeUndefined()
  })

  it('falls back rather than rendering nothing for an unknown key', () => {
    const resolved = describeStatus('not-a-real-status' as StatusKey)

    expect(resolved).toBe(STATUS.unknown)
  })
})

describe('the shell indicator', () => {
  /*
   * The whole reason this is a pure function. Reviewing it any other way means
   * turning the wifi off and rebuilding the service worker between each case.
   */

  it('reassures identically whether or not there is a network', () => {
    /*
     * The point of the change. `navigator.onLine` flipping to false at a venue
     * used to flip the one indicator in the shell to OFFLINE, which reads as a
     * fault in a product whose selling point is that this is fine. A device
     * that is prepared says so, and keeps saying so, exactly when it matters.
     */
    const connected = resolveOperationalStatus('ready', true)
    const dropped = resolveOperationalStatus('ready', false)

    expect(dropped.status).toBe('offline-ready')
    expect(dropped.status).toBe(connected.status)
    expect(dropped.label).toBe(connected.label)
    expect(describeStatus(dropped.status).tone).toBe('ok')
  })

  it('does not claim to be preparing when it cannot', () => {
    /*
     * Precaching needs a network. Showing "Preparing" on a device with no
     * connection is a promise it cannot keep, and it would leave an operator
     * waiting for a state that will never resolve.
     */
    expect(resolveOperationalStatus('preparing', true).status).toBe(
      'offline-preparing',
    )
    expect(resolveOperationalStatus('preparing', false).status).toBe('offline')
  })

  it('is the only red state in the shell', () => {
    const tones = (
      [
        resolveOperationalStatus('ready', false),
        resolveOperationalStatus('preparing', false),
        resolveOperationalStatus('unsupported', false),
        resolveOperationalStatus('failed', true),
      ] as const
    ).map((view) => describeStatus(view.status).tone)

    expect(tones.filter((tone) => tone === 'danger')).toHaveLength(1)
    expect(describeStatus(resolveOperationalStatus('failed', true).status).tone).toBe(
      'danger',
    )
  })

  it('falls back to plain connectivity when there is no readiness to report', () => {
    // A dev build or a browser without service workers. It reports the fact it
    // can still substantiate rather than inventing a reassurance.
    expect(resolveOperationalStatus('unsupported', true).status).toBe('online')
    expect(resolveOperationalStatus('unsupported', false).status).toBe('offline')
  })

  it('keeps every label short enough for a phone header', () => {
    for (const readiness of ['ready', 'preparing', 'failed', 'unsupported'] as const) {
      for (const online of [true, false]) {
        const view = resolveOperationalStatus(readiness, online)

        expect(view.label.length, `${readiness}/${online}: ${view.label}`)
          .toBeLessThanOrEqual(18)
        // The tooltip is additional, never the only place a fact appears.
        expect(view.title.length).toBeGreaterThan(view.label.length)
      }
    }
  })
})

describe('the V2 stylesheet', () => {
  const entry = withoutComments(read('src/styles/v2/index.css'))

  it('does not import Tailwind preflight', () => {
    /*
     * Preflight would unstyle every heading, list, table and control in the
     * four screens still rendered by `src/styles.css`, which are untouched by
     * this phase. The layers are therefore imported individually and the reset
     * is reproduced scoped to `.v2`.
     *
     * A bare `@import "tailwindcss"` pulls preflight in, so this asserts the
     * split form specifically.
     */
    expect(entry).not.toMatch(/@import\s+["']tailwindcss["']\s*;/)
    expect(entry).toContain("@import 'tailwindcss/theme.css'")
    expect(entry).toContain("@import 'tailwindcss/utilities.css'")
    expect(entry).not.toContain('preflight')
  })

  it('scopes every reset rule to the V2 subtree', () => {
    /*
     * A regression here is invisible in review and immediately visible at a
     * desk: one unscoped selector in this file restyles Point A.
     */
    const reset = withoutComments(read('src/styles/v2/reset.css'))
    const selectors = [...reset.matchAll(/^\s{2}([^@{}]+)\{/gm)].map((match) =>
      (match[1] as string).trim(),
    )

    expect(selectors.length).toBeGreaterThan(5)
    for (const selector of selectors) {
      for (const part of selector.split(',')) {
        expect(part.trim(), `unscoped reset selector: ${part.trim()}`).toMatch(
          /^\.v2\b/,
        )
      }
    }
  })
})

describe('the theme tokens', () => {
  const theme = withoutComments(read('src/styles/v2/theme.css'))

  /** Reads a declared pixel value, so the ladder is checked as numbers. */
  function pixels(name: string): number {
    const match = new RegExp(`--${name}:\\s*(\\d+)px`).exec(theme)
    expect(match, `--${name} is not declared as a pixel value`).not.toBeNull()

    return Number((match as RegExpExecArray)[1])
  }

  it('keeps the radius ladder tight, and proportional to the surface', () => {
    /*
     * The single thing that made the first foundation read as a generic
     * dashboard template. A 22px corner is right on a campaign landing surface
     * and wrong on a table of participant codes, and every rounded box in a
     * stack of them compounds it.
     *
     * Checked as an ordering rather than as four exact numbers, so the ladder
     * can be retuned but cannot be inverted or flattened.
     */
    const chip = pixels('radius-chip')
    const control = pixels('radius-control')
    const card = pixels('radius-card')
    const panel = pixels('radius-panel')

    expect(chip).toBeLessThan(control)
    expect(control).toBeLessThan(card)
    expect(card).toBeLessThan(panel)

    expect(control).toBeLessThanOrEqual(8)
    expect(card).toBeLessThanOrEqual(12)
    expect(panel).toBeLessThanOrEqual(16)
  })

  it('does not take its radii from V1 any more', () => {
    // V1's 12px/22px belong to V1, which this phase leaves untouched.
    expect(theme).not.toMatch(/--radius-(control|card):\s*var\(--ff-radius/)
  })

  it('lifts both secondary text weights above V1’s', () => {
    /*
     * These screens are read on a tablet, outdoors, at an angle, in daylight
     * that raises the black point of the display and collapses the effective
     * contrast of everything on it. V1's muted grey is 7.5:1 on a desk; its
     * faint weight was 3.7:1, below the floor, and it carries the event day.
     *
     * Asserted as "mixed toward the ink, not used raw", which is the property
     * that would silently regress if someone simplified these back.
     */
    expect(theme).toMatch(
      /--color-muted:\s*color-mix\(in srgb, var\(--ff-muted\) \d+%, var\(--ff-text\)\)/,
    )

    const faint = /--color-faint:\s*color-mix\(in srgb, var\(--ff-muted\) (\d+)%/.exec(
      theme,
    )
    expect(faint).not.toBeNull()
    expect(Number((faint as RegExpExecArray)[1])).toBeGreaterThanOrEqual(80)
  })

  it('keeps the two content measures far enough apart to be different ideas', () => {
    /*
     * A registration form and a reporting console are not the same surface.
     * Point A and Point B stay at a reading measure; Admin and Reporting get a
     * workspace roughly twice as wide.
     */
    expect(theme).toContain('--container-measure: var(--ff-content-max)')

    const wide = /--container-wide:\s*([\d.]+)rem/.exec(theme)
    expect(wide).not.toBeNull()
    expect(Number((wide as RegExpExecArray)[1])).toBeGreaterThanOrEqual(80)
  })

  it('keeps lime, teal and green meaning three different things', () => {
    /*
     * Lime is display, teal is anything you can operate, and green means a
     * healthy state. V1 defined `--ff-success` as the same value as
     * `--ff-interactive`, which made "this device is enrolled" and "press this"
     * the same colour; V2's `ok` is a distinct green and must stay one.
     */
    const ok = /--color-ok:\s*(#[0-9a-fA-F]{3,8})/.exec(theme)?.[1]

    expect(ok).toBeDefined()
    expect(theme).toContain('--color-accent: var(--ff-accent)')
    expect(theme).toContain('--color-interactive: var(--ff-interactive)')
    expect(theme).not.toMatch(/--color-ok:\s*var\(--ff-(interactive|success|accent)\)/)
  })
})

describe('the cascade order', () => {
  const app = withoutComments(read('src/styles/app.css'))

  it('puts the V1 stylesheet in a layer beneath Tailwind', () => {
    /*
     * A defect that was made and fixed during this phase.
     *
     * Cascade layers outrank specificity, and unlayered rules beat every
     * layered rule. While `styles.css` was unlayered its global
     * `a { color: var(--accent) }` outranked every Tailwind colour utility
     * inside the V2 subtree, so the application shell's navigation rendered
     * teal and underlined with `text-muted` sitting in the DOM, losing.
     *
     * If this import ever loses its `layer()`, the same class of bug returns
     * silently for every element selector V1 declares.
     */
    expect(app).toMatch(/@layer\s+v1\s*,/)
    expect(app).toMatch(/@import\s+['"]\.\.\/styles\.css['"]\s+layer\(v1\)/)
  })

  it('declares v1 before Tailwind’s own layers', () => {
    const declaration = /@layer\s+([^;]+);/.exec(app)?.[1] ?? ''
    const order = declaration.split(',').map((name) => name.trim())

    expect(order[0]).toBe('v1')
    expect(order).toContain('utilities')
    expect(order.indexOf('v1')).toBeLessThan(order.indexOf('utilities'))
  })

  it('is reached through a single entry point', () => {
    /*
     * Layer order can only be established by the first stylesheet to declare
     * it. Importing `styles.css` directly from `main.tsx` alongside the V2
     * sheet is what created the bug above, because a stylesheet imported
     * unlayered cannot be retro-layered.
     */
    const main = withoutComments(read('src/main.tsx'))

    expect(main).toContain("import './styles/app.css'")
    expect(main).not.toMatch(/import\s+['"]\.\/styles\.css['"]/)
  })
})

describe('the primitives', () => {
  it('are all present and none was added without being needed', () => {
    // Established deliberately rather than by installing the whole catalogue.
    const names = primitives().map((file) => file.name).sort()

    expect(names).toEqual([
      'alert.tsx',
      'badge.tsx',
      'button.tsx',
      'card.tsx',
      'dialog.tsx',
      'dropdown-menu.tsx',
      'input.tsx',
      'label.tsx',
      'select.tsx',
      'separator.tsx',
      'sheet.tsx',
      'skeleton.tsx',
      'table.tsx',
      'tabs.tsx',
      'tooltip.tsx',
    ])
  })

  it('give every control a comfortable touch target', () => {
    /*
     * Operators work standing up, on tablets, several hundred times a shift.
     * 44px is the floor, and a control that quietly drops below it is the kind
     * of regression nobody notices on a desktop with a mouse.
     */
    const touched = ['button.tsx', 'input.tsx', 'select.tsx']

    for (const name of touched) {
      const source = read(join(UI_DIR, name))
      expect(source, `${name} declares no touch-sized target`).toMatch(
        /min-h-touch|size-touch/,
      )
    }
  })

  it('never hardcode a colour outside the token system', () => {
    /*
     * The whole point of the theme. A component that reaches for a hex value
     * is one that will not follow a palette change, and its drift is invisible
     * until the two shades are side by side.
     */
    for (const { name, source } of primitives()) {
      const hexes = withoutComments(source).match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
      expect(hexes, `${name} hardcodes ${hexes.join(', ')}`).toEqual([])
    }
  })

  it('keep a visible focus ring on everything focusable', () => {
    /*
     * The default focus ring is invisible against a near-black surface, and
     * these screens are driven by keyboards and by barcode scanners that
     * behave like keyboards.
     */
    const focusable = [
      'button.tsx',
      'input.tsx',
      'select.tsx',
      'tabs.tsx',
      'dialog.tsx',
      'sheet.tsx',
    ]

    for (const name of focusable) {
      expect(read(join(UI_DIR, name)), `${name} has no focus ring`).toContain(
        'focus-visible:',
      )
    }
  })
})

describe('the design-system layer', () => {
  it('is what feature code imports, and re-exports every component', () => {
    const barrel = read(join(DESIGN_SYSTEM_DIR, 'index.ts'))
    const components = readdirSync(DESIGN_SYSTEM_DIR)
      .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
      .map((file) => file.replace(/\.tsx$/, ''))

    for (const component of components) {
      expect(barrel, `${component} is not exported from the barrel`).toContain(
        `./${component}'`,
      )
    }
  })

  it('never reaches around the primitives into Radix directly', () => {
    /*
     * The three layers only mean something if each one goes through the one
     * below. A design-system component importing Radix directly would be a
     * second, undocumented primitive layer with its own styling decisions.
     */
    for (const file of readdirSync(DESIGN_SYSTEM_DIR).filter((name) =>
      name.endsWith('.tsx'),
    )) {
      const source = read(join(DESIGN_SYSTEM_DIR, file))
      expect(source, `${file} imports Radix directly`).not.toMatch(
        /from ['"]@radix-ui\//,
      )
    }
  })
})
