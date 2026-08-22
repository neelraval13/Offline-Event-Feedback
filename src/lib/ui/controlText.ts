/**
 * The text size every editable control uses.
 *
 * ## The behaviour this exists for
 *
 * iOS and iPadOS Safari zoom the whole page when a text control whose font is
 * smaller than 16px takes focus. It is not a preference and there is no way to
 * decline it: the only switches that suppress it, `maximum-scale=1` and
 * `user-scalable=no`, also take away the reader's own pinch zoom, which is not
 * a trade this product will make.
 *
 * At a registration desk that zoom is expensive. The operator loses their place
 * on every field, on every rider, for a whole shift.
 *
 * ## Why two conditions rather than a breakpoint
 *
 * `pointer-coarse` is the accurate one. The zoom is a property of the device,
 * not of how wide its window happens to be, and an iPad in landscape reports
 * 1024px or more: any width-based rule alone leaves the exact tablets this
 * product runs on still zooming.
 *
 * `max-md` is kept alongside it so the guarantee is also verifiable the obvious
 * way, by narrowing a desktop browser, which reports a fine pointer and would
 * otherwise show 15px at 440px and look like the fix had not worked.
 *
 * A desktop pointer at a desktop width keeps `--text-base`, which is the
 * typography the V2 scale intends for a control. Nothing else changes.
 */
export const CONTROL_TEXT =
  'text-base max-md:text-control pointer-coarse:text-control'
