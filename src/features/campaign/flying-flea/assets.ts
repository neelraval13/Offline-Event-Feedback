import type { FlyingFleaColour } from '../../../types'

/*
 * The campaign's photography.
 *
 * Plain constants. These files are part of the application: they ship in
 * `public/assets/flying-flea/`, they are precached with the shell, and a build
 * without them is a broken build rather than a degraded one. So there is no
 * existence check, no probe and no fallback — asking at runtime whether an asset
 * this application owns happens to be present would be answering a question
 * that cannot be yes-or-no in production.
 *
 * Every path is same-origin and absolute. The reference page hot-links all three
 * from Royal Enfield's CDN and its own README says so; carrying those URLs over
 * would mean a registration desk with no Wi-Fi shows broken images where the
 * motorcycle should be.
 *
 * The bikes are transparent PNG-style WebP on a shared canvas, so they sit on
 * the dark card without a visible plate behind them.
 */

/** Where each image lives. Keyed by the persisted campaign value. */
export const MOTORCYCLE_IMAGES: Readonly<Record<FlyingFleaColour, string>> = {
  'Flea Green': '/assets/flying-flea/bike-flea-green.webp',
  'Storm Black': '/assets/flying-flea/bike-storm-black.webp',
}

/** Alt text, so a screen reader is told which motorcycle is on screen. */
export const MOTORCYCLE_ALT: Readonly<Record<FlyingFleaColour, string>> = {
  'Flea Green': 'Flying Flea C6 in Flea Green',
  'Storm Black': 'Flying Flea C6 in Storm Black',
}

/**
 * The wide campaign banner across the top of both stations.
 *
 * A web derivative at 2400×1274; the 5913×3140 master is kept out of the
 * application in `design/assets/`. An 18-megapixel banner costs a tablet ~74 MB
 * of decoded image and most of the precache to render a strip a few hundred
 * pixels tall.
 */
export const REGISTRATION_HEADER_IMAGE = '/assets/flying-flea/registration-header.webp'

export const REGISTRATION_HEADER_ALT =
  'A rider standing beside a Flying Flea C6 on a city street'
