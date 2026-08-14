import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/*
 * Typography, checked as configuration rather than as pixels.
 *
 * jsdom does not lay out text, so nothing here asserts how anything looks. What
 * it does assert is the part that silently breaks: that every face is served
 * from this application, that no remote font sneaks back in, and that the three
 * roles exist as tokens rather than as font-family declarations scattered
 * through components.
 */

/**
 * CSS with comments removed.
 *
 * These files explain at length what they deliberately do NOT do (load Anton,
 * reach fonts.googleapis.com), and an assertion that read the prose would fail
 * on its own documentation. Declarations are what is under test.
 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

const fonts = withoutComments(readFileSync('src/styles/fonts.css', 'utf8'))
const tokens = withoutComments(readFileSync('src/styles/tokens.css', 'utf8'))
const stylesheet = withoutComments(readFileSync('src/styles.css', 'utf8'))

const FONT_DIRECTORY = 'public/fonts'

describe('the font files', () => {
  it('are in the repository, not on a font host', () => {
    const files = readdirSync(FONT_DIRECTORY)

    expect(files).toContain('FlyingFlea-Bold.otf')
    expect(files).toContain('Graphik-Medium.otf')
    expect(files).toContain('Inter_18pt-Medium.ttf')
    expect(files).toContain('Inter_18pt-Bold.ttf')
  })

  it('are each referenced by a @font-face rule that resolves', () => {
    const sources = [...fonts.matchAll(/url\('([^']+)'\)/g)].map(
      (match) => match[1] as string,
    )

    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      // Same-origin absolute paths, served from `public/`.
      expect(source.startsWith('/fonts/')).toBe(true)
      expect(existsSync(join('public', source))).toBe(true)
    }
  })

  it('are never fetched from a remote host', () => {
    /*
     * A heading that waits on fonts.googleapis.com is a heading that never
     * arrives at a venue with no Wi-Fi. The reference page loaded Anton and
     * Inter that way; this application does not.
     */
    for (const css of [fonts, tokens, stylesheet]) {
      expect(css).not.toContain('http://')
      expect(css).not.toContain('https://')
      expect(css).not.toContain('fonts.googleapis.com')
      expect(css).not.toContain('fonts.gstatic.com')
    }
  })

  it('swap rather than hiding text while they load', () => {
    const declarations = [...fonts.matchAll(/@font-face\s*\{[^}]*\}/g)].map(
      (match) => match[0],
    )

    expect(declarations.length).toBe(4)
    for (const declaration of declarations) {
      expect(declaration).toContain('font-display: swap')
    }
  })

  it('no longer names the reference’s stand-in display face', () => {
    // Anton was standing in for the campaign's own face, which we now have.
    for (const css of [fonts, tokens, stylesheet]) {
      expect(css).not.toContain('Anton')
      expect(css).not.toContain('Rajdhani')
    }
  })
})

describe('the typography tokens', () => {
  it('define one token per role', () => {
    for (const token of [
      '--ff-font-display',
      '--ff-font-body',
      '--ff-font-ui',
      '--ff-font-text',
    ]) {
      expect(tokens).toContain(`${token}:`)
    }
  })

  it('map each role to the intended family', () => {
    expect(tokens).toMatch(/--ff-font-display:\s*\n?\s*'FlyingFlea'/)
    expect(tokens).toMatch(/--ff-font-body:\s*'Graphik'/)
    expect(tokens).toMatch(/--ff-font-ui:\s*\n?\s*'Inter'/)
  })

  it('keep a system fallback behind every role', () => {
    // A face that fails to load should degrade to something legible rather
    // than to nothing.
    expect(tokens).toContain('sans-serif')
    expect(tokens).toMatch(/--ff-font-body:[^;]*var\(--ff-font-ui\)/)
    expect(tokens).toMatch(/--ff-font-display:[^;]*var\(--ff-font-ui\)/)
  })
})

describe('components consume the tokens', () => {
  it('never hardcode a campaign family outside the tokens', () => {
    /*
     * A literal `font-family: 'FlyingFlea'` in a component rule is how one
     * screen ends up in a different face after a campaign changes its type. The
     * families are named once, in the tokens, and referenced everywhere else.
     *
     * System stacks are a different thing and are allowed: a monospace public
     * code and the printed sticker deliberately avoid the campaign faces.
     */
    const declarations = [...stylesheet.matchAll(/font-family:\s*([^;]+);/g)].map(
      (match) => (match[1] as string).trim(),
    )

    expect(declarations.length).toBeGreaterThan(0)
    for (const declaration of declarations) {
      for (const family of ['FlyingFlea', 'Graphik', 'Inter']) {
        expect(declaration).not.toContain(family)
      }
    }
  })

  it('keeps the printed sticker off the campaign faces entirely', () => {
    /*
     * The sticker is printed and scanned. It must render identically whether or
     * not a web font loaded, so it uses a system stack and a monospace code,
     * branding on a label is worth nothing next to a code staff can read back.
     */
    expect(stylesheet).toMatch(
      /\.sticker__code\s*\{[^}]*font-family:\s*ui-monospace/,
    )
  })

  it('gives the display face to headings and the prose face to reading copy', () => {
    expect(stylesheet).toMatch(/\.ff-display\s*\{[^}]*var\(--ff-font-display\)/)
    expect(stylesheet).toMatch(/\.ff-question__prompt\s*\{[^}]*var\(--ff-font-body\)/)
  })
})
