import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  cn,
  V2_CONTAINERS,
  V2_FONT_SIZES,
  V2_RADII,
  V2_SHADOWS,
  V2_SPACING,
} from './cn'

/*
 * The class merger, checked against the theme it merges for.
 *
 * These pin a defect that was real, silent and systemic. `tailwind-merge`
 * resolves conflicts from stock Tailwind's class names, so every renamed scale
 * in this theme was filed in the wrong group: font sizes looked like text
 * colours and were deleted, and radii, spacings, measures and shadows looked
 * like nothing at all and stopped resolving. The visible symptom of the first
 * was type one step too small in whichever components happened to compose a
 * size with a conditional colour, which is not a bug anybody files.
 */

const THEME = readFileSync('src/styles/v2/theme.css', 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/** Every value the stylesheet declares for one custom-property namespace. */
function declared(prefix: string): string[] {
  return [...THEME.matchAll(new RegExp(`--${prefix}-([a-z-]+):`, 'g'))]
    .map((match) => match[1] as string)
    .sort()
}

describe('cn', () => {
  it('keeps a font size and a text colour together', () => {
    /*
     * The defect, in one line. Before the merger was taught this theme's size
     * names this returned `font-display text-muted`, and the 40px was gone.
     */
    const result = cn('font-display text-display', 'text-muted')

    expect(result).toContain('text-display')
    expect(result).toContain('text-muted')
  })

  it('keeps every one of the theme’s sizes, not just the one that was noticed', () => {
    for (const size of V2_FONT_SIZES) {
      const result = cn(`text-${size}`, 'text-faint')

      expect(result, `text-${size} was dropped`).toContain(`text-${size}`)
      expect(result).toContain('text-faint')
    }
  })

  it('resolves the conflicts it exists to resolve, in every renamed scale', () => {
    // Nothing was deleted in these cases before the fix; both classes survived
    // and CSS source order decided, which is the coin toss `cn` removes.
    expect(cn('text-small', 'text-lead')).toBe('text-lead')
    expect(cn('rounded-control', 'rounded-panel')).toBe('rounded-panel')
    expect(cn('p-4', 'p-gutter')).toBe('p-gutter')
    expect(cn('gap-page', 'gap-2')).toBe('gap-2')
    expect(cn('max-w-md', 'max-w-station')).toBe('max-w-station')
    expect(cn('shadow-md', 'shadow-dialog')).toBe('shadow-dialog')
    expect(cn('min-h-touch', 'min-h-9')).toBe('min-h-9')
  })

  it('leaves utilities that do not conflict alone', () => {
    expect(cn('rounded-card border border-line')).toBe(
      'rounded-card border border-line',
    )
    expect(cn('text-muted', 'text-ink')).toBe('text-ink')
    expect(cn('px-4', 'px-6')).toBe('px-6')
  })

  it('lists exactly the scales the stylesheet declares', () => {
    /*
     * The drift guard. A scale added to the theme and forgotten here goes
     * straight back to being misfiled, which for `--text-*` means silently
     * deleted. This is the test that makes the second copy safe to keep.
     */
    expect(declared('text')).toEqual([...V2_FONT_SIZES].sort())
    expect(declared('radius')).toEqual([...V2_RADII].sort())
    expect(declared('spacing')).toEqual([...V2_SPACING].sort())
    expect(declared('container')).toEqual([...V2_CONTAINERS].sort())
    expect(declared('shadow')).toEqual([...V2_SHADOWS].sort())
  })
})
