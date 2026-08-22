import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/*
 * Class-name joining that understands this product's theme.
 *
 * ## Why this is not just `twMerge`
 *
 * `clsx` alone would produce `px-4 px-6`, and which one applies then depends on
 * the order Tailwind happened to emit them in rather than on the order the
 * caller wrote them. `twMerge` resolves that the way a reader expects: a caller
 * passing `className="px-6"` to a component whose default is `px-4` gets 24px,
 * every time. That is what makes every V2 component overridable at the call
 * site without needing a prop for each thing somebody might want to change.
 *
 * But `twMerge` resolves conflicts from a table of *stock* Tailwind class
 * names, and this theme renames every scale it has. Left unconfigured it gets
 * two different things wrong, and one of them is silent.
 *
 * ## The silent one: a font size deleted
 *
 * `twMerge` has no idea that `text-page` is a font size while `text-muted` is a
 * colour. It sees two `text-*` utilities, decides the later one wins, and
 * drops the size:
 *
 *     cn('font-display text-display', 'text-muted')  ->  'font-display text-muted'
 *
 * Nothing errors. The class is simply absent from the DOM and the element
 * renders at whatever it inherited. It cost a vehicle plate its 40px numeral
 * before it was noticed, and it was quietly costing sizes anywhere a component
 * composed a size with a conditional colour in one call. `text-base` was the
 * one that always worked, because `base` is a size name stock Tailwind knows,
 * which is exactly what made it so hard to see.
 *
 * ## The loud one: a conflict left unresolved
 *
 * `rounded-control rounded-panel`, `p-4 p-gutter`, `max-w-md max-w-station`,
 * `shadow-md shadow-dialog`: nothing is deleted, both classes survive, and CSS
 * source order decides. That is precisely the coin-toss `cn` exists to remove,
 * so a call-site override might or might not take effect.
 *
 * ## The fix
 *
 * Declare the theme's own scales. `twMerge` then files each utility in the
 * right group, sizes and colours stop competing, and real conflicts resolve
 * again: `text-small text-lead` yields `text-lead`, `text-muted text-ink`
 * yields `text-ink`.
 *
 * These lists are a second copy of what `src/styles/v2/theme.css` declares, and
 * a second copy is a thing that drifts. `cn.test.ts` compares them against the
 * stylesheet so a scale added there and forgotten here fails a test rather than
 * silently going back to being deleted.
 */

/** The theme's font sizes, by the name their utility uses. `--text-*`. */
export const V2_FONT_SIZES = [
  'caption',
  'label',
  'small',
  'base',
  'lead',
  'title',
  'page',
  'display',
  'stat',
  'stat-small',
] as const

/** `--radius-*`. */
export const V2_RADII = ['chip', 'control', 'card', 'panel', 'pill'] as const

/** `--spacing-*`. Feeds padding, margin, gap, size and the rest. */
export const V2_SPACING = ['gutter', 'section', 'page', 'touch'] as const

/** `--container-*`. The content measures. */
export const V2_CONTAINERS = ['measure', 'station', 'wide'] as const

/** `--shadow-*`. Only the two things that genuinely float. */
export const V2_SHADOWS = ['popover', 'dialog'] as const

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...V2_FONT_SIZES],
      radius: [...V2_RADII],
      spacing: [...V2_SPACING],
      container: [...V2_CONTAINERS],
      shadow: [...V2_SHADOWS],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
