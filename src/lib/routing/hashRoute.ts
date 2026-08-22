/**
 * Minimal hash-based routing.
 *
 * Hash routing is a deliberate choice over the History API: the built app must
 * run from a static file server, a USB stick or a laptop at the venue with no
 * rewrite rules and no internet. `#/b` always resolves to `index.html`.
 */

export const ROUTE_PATHS = [
  '/',
  '/a',
  '/b',
  '/admin',
  '/reporting',
  /*
   * The V2 design-system gallery. Unlisted in navigation, like `/reporting`,
   * because it is not a station: it exists so the foundation can be reviewed
   * in a browser rather than read as source.
   */
  '/foundation',
  /*
   * The Point A V2 concept. A design-review surface, not a station.
   *
   * Deliberately a separate path from `/a`, which still renders the production
   * registration terminal untouched. The concept writes nothing, calls no
   * registration function and holds no real record; it exists so the V2 design
   * can be agreed by looking at it before any of it is implemented.
   */
  '/concept/point-a',
  /*
   * The Point B V2 concept. Same rules as the Point A one: a design-review
   * surface on static fixtures, deliberately a separate path from `/b`, which
   * still renders the production feedback terminal untouched. It opens no
   * camera, calls no scanner and writes nothing.
   */
  '/concept/point-b',
  /*
   * The Device Admin V2 concept. Same rules as the other two: a design-review
   * surface on static fixtures, deliberately a separate path from `/admin`,
   * which still renders the production console untouched. It opens no database,
   * runs no sync, enrols nothing and touches no backup.
   */
  '/concept/admin',
] as const

export type RoutePath = (typeof ROUTE_PATHS)[number]

function isRoutePath(value: string): value is RoutePath {
  return (ROUTE_PATHS as readonly string[]).includes(value)
}

/**
 * Reduces a raw `location.hash` to a comparable path.
 *
 * Tolerates the shapes staff and browsers actually produce: a missing hash,
 * `#a` without a slash, a trailing slash, mixed case, and a query string
 * appended by a scanner or a shared link.
 */
export function normalizeHashPath(rawHash: string): string {
  const withoutHash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
  const withoutQuery = withoutHash.split(/[?#]/, 1)[0] ?? ''
  const withLeadingSlash = withoutQuery.startsWith('/')
    ? withoutQuery
    : `/${withoutQuery}`
  const trimmed = withLeadingSlash.replace(/\/+$/, '')
  return (trimmed === '' ? '/' : trimmed).toLowerCase()
}

/** Resolves a raw hash to a known route, or `null` when it matches none. */
export function matchRoute(rawHash: string): RoutePath | null {
  const path = normalizeHashPath(rawHash)
  return isRoutePath(path) ? path : null
}

/** The `href` that navigates to a route. */
export function hrefFor(path: RoutePath): string {
  return `#${path}`
}
