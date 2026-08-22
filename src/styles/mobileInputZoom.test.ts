import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CONTROL_TEXT } from '../lib/ui/controlText'

/*
 * iOS and iPadOS Safari zoom the page when a text control under 16px takes
 * focus, and the only ways to refuse that zoom also remove the reader's own.
 * So the size has to be right at the source.
 *
 * This was wrong in the shipped product for the whole V2 redesign: every field
 * carried `text-base`, a comment above the input primitive asserted that this
 * was 16px and therefore safe, and `--text-base` was 15px. The comment was
 * checked in review; the token was not.
 *
 * A test that reads computed pixels cannot catch that. jsdom lays nothing out,
 * and the failure is a media query on a device no CI machine has. What is
 * checkable is the rule: every editable control in the product uses the one
 * shared class string, and that string resolves to at least 16px on the
 * devices that zoom.
 */

const TOKENS = readFileSync('src/styles/v2/theme.css', 'utf8')

/** Every `.tsx` under `src/`, so a new control cannot be added unnoticed. */
function componentFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...componentFiles(path))
    } else if (path.endsWith('.tsx') && !path.endsWith('.test.tsx')) {
      found.push(path)
    }
  }
  return found
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * Comments and import statements removed, so "this file mentions CONTROL_TEXT"
 * cannot be satisfied by an import the component no longer uses.
 */
function componentBody(path: string): string {
  return withoutComments(readFileSync(path, 'utf8')).replace(
    /^import[\s\S]*?from\s*'[^']*'\n/gm,
    '',
  )
}

/**
 * Text sizes the V2 scale defines, in pixels, so a class name can be resolved
 * to the number that actually matters here.
 */
function tokenPx(name: string): number {
  const match = new RegExp(`--text-${name}:\\s*([0-9.]+)rem`).exec(TOKENS)
  if (match?.[1] === undefined) {
    throw new Error(`--text-${name} is not defined in the V2 theme`)
  }
  return Number(match[1]) * 16
}

const SAFARI_ZOOM_THRESHOLD_PX = 16

describe('the shared control text size', () => {
  it('reaches 16px on the devices that zoom', () => {
    /*
     * `--text-control` is the whole point of the mechanism. If it drifts back
     * under the threshold every field in the product silently starts zooming
     * again, with no other symptom.
     */
    expect(tokenPx('control')).toBeGreaterThanOrEqual(SAFARI_ZOOM_THRESHOLD_PX)
  })

  it('applies on a coarse pointer and at narrow widths, not one or the other', () => {
    /*
     * Both conditions are required and they cover different failures. Width
     * alone leaves an iPad in landscape, which reports 1024px or more, still
     * zooming; pointer alone cannot be verified by narrowing a desktop browser,
     * which reports a fine pointer.
     */
    expect(CONTROL_TEXT).toContain('pointer-coarse:text-control')
    expect(CONTROL_TEXT).toContain('max-md:text-control')
  })

  it('never sets a control below the threshold at any breakpoint', () => {
    // A `sm:`/`md:`/`lg:` step back down would reintroduce the bug above the
    // breakpoint while every narrow-viewport check kept passing.
    for (const step of CONTROL_TEXT.split(/\s+/)) {
      const size = /text-(caption|label|small|base|lead|title|page|display)$/.exec(step)
      if (size?.[1] === undefined) continue
      if (!step.includes(':')) continue
      expect(
        tokenPx(size[1]),
        `${step} drops a control below ${SAFARI_ZOOM_THRESHOLD_PX}px`,
      ).toBeGreaterThanOrEqual(SAFARI_ZOOM_THRESHOLD_PX)
    }
  })
})

describe('every editable control in the product', () => {
  /*
   * `input`, `textarea` and `select` are exactly the elements Safari zooms.
   * Buttons, including the Radix select trigger, are not typed into and are not
   * affected.
   */
  const EDITABLE = /<(input|textarea|select)\b/

  /*
   * Files whose control is deliberately set larger than `CONTROL_TEXT` rather
   * than by it, mapped to the size step they use. Each one is verified below
   * rather than trusted, so an exemption cannot become a hiding place.
   *
   * The participant code is set in `text-lead` because the operator reads it
   * back character by character against a printed sticker. 17px is already
   * over the threshold, so the shared string would only make it smaller.
   */
  const EXEMPT: Readonly<Record<string, string>> = {
    'src/features/feedback/ManualCodeEntry.tsx': 'lead',
  }

  const controls = componentFiles('src').filter((path) =>
    EDITABLE.test(withoutComments(readFileSync(path, 'utf8'))),
  )

  it('was actually found, so this file is not asserting over an empty list', () => {
    expect(controls.length).toBeGreaterThan(4)
  })

  it('uses the shared control size, or a documented larger one', () => {
    const offenders = controls.filter((path) => {
      if (path in EXEMPT) return false
      return !componentBody(path).includes('CONTROL_TEXT')
    })

    expect(offenders).toEqual([])
  })

  it('still clears the threshold in the files that opt out', () => {
    for (const [path, size] of Object.entries(EXEMPT)) {
      // The exemption is only valid while the file really does use that step.
      const source = componentBody(path)
      expect(source, `${path} no longer uses text-${size}`).toContain(`text-${size}`)
      expect(tokenPx(size)).toBeGreaterThanOrEqual(SAFARI_ZOOM_THRESHOLD_PX)
    }
  })

  it('lists no exemption for a file that has since been deleted', () => {
    for (const path of Object.keys(EXEMPT)) {
      expect(controls, `${path} is exempt but holds no control`).toContain(path)
    }
  })
})
