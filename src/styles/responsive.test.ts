import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/*
 * Responsiveness, checked as configuration rather than as pixels.
 *
 * jsdom does not lay anything out. It has no viewport, no font metrics and no
 * grid algorithm, so a test that claimed "the form does not scroll sideways at
 * 320px" would be asserting nothing. Manual QA at real widths is the only thing
 * that proves that, and `docs/flying-flea-qa.md` carries the matrix.
 *
 * What can be checked here is the class of mistake that is invisible in review
 * and fatal on a small screen:
 *
 *   - an `auto-fit` track whose floor is wider than its container, which is the
 *     usual cause of a page that scrolls sideways on a phone
 *   - a global `overflow-x: hidden`, which hides exactly that bug rather than
 *     fixing it
 *   - an input under 16px, which makes mobile Safari zoom the page on focus
 *   - a layout container pinned to a fixed width
 */

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

const stylesheet = withoutComments(readFileSync('src/styles.css', 'utf8'))
const tokens = withoutComments(readFileSync('src/styles/tokens.css', 'utf8'))

describe('grid tracks', () => {
  it('never declare a minimum wider than the container they sit in', () => {
    /*
     * `repeat(auto-fit, minmax(260px, 1fr))` keeps its 260px floor even when
     * the container is 240px wide, and the grid then overflows. Wrapping the
     * floor in `min(…, 100%)` lets the single remaining column shrink instead.
     */
    // The floor may itself contain a comma, as `min(260px, 100%)` does.
    const tracks = [
      ...stylesheet.matchAll(
        /repeat\(auto-fit,\s*minmax\((.+?),\s*1fr\)\)/g,
      ),
    ].map((match) => (match[1] as string).trim())

    expect(tracks.length).toBeGreaterThanOrEqual(5)
    for (const floor of tracks) {
      expect(floor.startsWith('min(')).toBe(true)
      expect(floor).toContain('100%')
    }
  })
})

describe('horizontal overflow', () => {
  it('is never concealed with a global clip', () => {
    // Hiding the symptom means the next person cannot see the cause.
    for (const selector of ['html', 'body', '#root', '.app-shell']) {
      const rule = new RegExp(
        `${selector.replace('.', '\\.')}\\s*(,[^{]*)?\\{[^}]*overflow-x:\\s*hidden`,
      )
      expect(stylesheet).not.toMatch(rule)
    }
  })
})

describe('the content container', () => {
  it('is fluid up to a reading measure rather than a fixed column', () => {
    const screen = /\.screen \{[^}]*\}/.exec(stylesheet)?.[0] ?? ''

    expect(screen).toContain('width: min(100%, var(--ff-content-max))')
    expect(screen).not.toContain('max-width: 44rem')
  })

  it('takes its gutter from a token, so every screen agrees', () => {
    expect(tokens).toContain('--ff-gutter:')
    expect(tokens).toContain('--ff-content-max:')
    expect(stylesheet).toContain('padding: 1.5rem var(--ff-gutter) 3rem')
  })
})

describe('text inputs', () => {
  it('are never small enough to make mobile Safari zoom the page', () => {
    /*
     * Focusing an input under 16px makes iOS scale the page up and leave it
     * there, which at a registration desk means the operator scrolls sideways
     * for the rest of the form.
     */
    const controls = [
      /\.ff-field__control \{[^}]*\}/,
      /\.ff-dial__input \{[^}]*\}/,
      /\.field__input \{[^}]*\}/,
      /\.manual-entry__input \{[^}]*\}/,
    ]

    for (const pattern of controls) {
      const rule = pattern.exec(stylesheet)?.[0]
      expect(rule).toBeDefined()

      const size = /font-size:\s*([\d.]+)(px|rem)/.exec(rule as string)
      if (size === null) {
        // Inherits the 17px body size, which is already above the threshold.
        continue
      }

      const value =
        size[2] === 'rem'
          ? Number.parseFloat(size[1] as string) * 16
          : Number.parseFloat(size[1] as string)

      expect(value).toBeGreaterThanOrEqual(16)
    }
  })
})

describe('touch targets', () => {
  it('are declared as a token rather than left to padding', () => {
    // Padding shrinks with the font; a minimum height does not.
    expect(tokens).toContain('--ff-touch: 44px')

    for (const rule of [
      /\.button \{[^}]*\}/,
      /\.ff-field__control \{[^}]*\}/,
      /\.ff-rating__button \{[^}]*\}/,
    ]) {
      expect(rule.exec(stylesheet)?.[0]).toContain('var(--ff-touch)')
    }
  })

  it('keep the numeric keypad pressable at any dial size', () => {
    const key = /\.ff-dial__key \{[^}]*\}/.exec(stylesheet)?.[0] ?? ''

    expect(key).toContain('min-height: max(38px')
  })
})

describe('media queries', () => {
  it('are few, and grouped rather than scattered', () => {
    /*
     * Layout is decided by `auto-fit`, `clamp()` and container queries, so a
     * breakpoint is the exception. Print and reduced-motion are not viewport
     * rules and do not count against that.
     */
    const viewportQueries = [
      ...stylesheet.matchAll(/@media \(((?:max|min)-width): (\d+)px\)/g),
    ].map((match) => `${match[1]}:${match[2]}`)

    expect(viewportQueries).toEqual(['max-width:480', 'min-width:1024'])
  })

  it('keep the seven-point scale on one row until it stops fitting', () => {
    const small = /@media \(max-width: 480px\) \{[\s\S]*?\n\}/.exec(stylesheet)?.[0] ?? ''

    expect(stylesheet).toContain('grid-template-columns: repeat(7, minmax(0, 1fr))')
    expect(small).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
  })
})
