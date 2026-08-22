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
 * ## What is left of this file
 *
 * Most of it used to check V1 rules: the numeric dial's keypad, the rating
 * lamps, the field controls, the old content gutter. Those components are gone
 * and their stylesheet with them, so assertions about them would pass against
 * an empty string and prove nothing. What remains are the two classes of
 * mistake that are still possible, still invisible in review, and still fatal
 * on a small screen. Both are now checked against every stylesheet the
 * application actually ships.
 *
 * Touch-target sizing moved with the components: `designSystem.test.ts` checks
 * that the V2 primitives declare `min-h-touch`, which is where a control's
 * height is decided now.
 */

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

const SHEETS = [
  'src/styles.css',
  'src/styles/app.css',
  'src/styles/tokens.css',
  'src/styles/v2/index.css',
  'src/styles/v2/reset.css',
  'src/styles/v2/theme.css',
] as const

const sheets = SHEETS.map((path) => ({
  path,
  css: withoutComments(readFileSync(path, 'utf8')),
}))

describe('horizontal overflow', () => {
  it('is never concealed with a global clip', () => {
    /*
     * Hiding the symptom means the next person cannot see the cause. A page
     * that scrolls sideways on a phone has a child wider than its container,
     * and `overflow-x: hidden` on the document makes that child unreachable
     * instead of making it fit.
     */
    for (const { path, css } of sheets) {
      for (const selector of ['html', 'body', '#root']) {
        const rule = new RegExp(
          `${selector}\\s*(,[^{]*)?\\{[^}]*overflow-x:\\s*hidden`,
        )
        expect(css, `${path} clips ${selector}`).not.toMatch(rule)
      }
    }
  })
})

describe('text inputs', () => {
  it('are set in the largest of the small type steps, never a smaller one', () => {
    /*
     * A control that is typed into on a phone must not shrink with the
     * viewport. `text-base` is the step the V2 scale gives to body and
     * controls; anything below it is metadata sizing and belongs on a caption,
     * not on a field an operator is reading their own typing in.
     *
     * `file:`-prefixed utilities are excluded: they style the button inside a
     * file input, not the value.
     */
    // Comments stripped first: the note above the component discusses
    // `md:text-small` in order to say it is deliberately absent.
    const input = withoutComments(readFileSync('src/components/ui/input.tsx', 'utf8'))
    const ownText = input.replace(/file:[a-z0-9:[\]/-]+/g, '')

    expect(ownText).toMatch(/\btext-base\b/)
    expect(ownText).not.toMatch(/\btext-(?:small|caption|label)\b/)
    // And it never trades height for density at a breakpoint.
    expect(input).toMatch(/min-h-touch/)
    expect(input).not.toMatch(/(?:sm|md|lg):min-h-/)
  })
})
