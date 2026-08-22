import { describe, expect, it } from 'vitest'
import { ROUTES } from './routes'
import { ROUTE_PATHS, matchRoute } from '../lib/routing/hashRoute'

/*
 * The production surface, pinned.
 *
 * Five routes and no more. Through the redesign this application also carried
 * a design-system gallery and four concept surfaces, each a full screen of
 * review-only code on static fixtures; the Reporting one alone held a thousand
 * lines of invented participants. They existed to be looked at and approved,
 * and once they were, they were exactly the kind of thing that survives in a
 * codebase for years because nothing fails when it does.
 *
 * This file is what fails. A route added here has to be added deliberately,
 * and a review surface reintroduced by accident does not reach a build.
 */

const PRODUCTION_ROUTES = ['/', '/a', '/b', '/admin', '/reporting'] as const

describe('the production route table', () => {
  it('exposes exactly the five intended surfaces', () => {
    expect([...ROUTE_PATHS].sort()).toEqual([...PRODUCTION_ROUTES].sort())
    expect(ROUTES.map((route) => route.path).sort()).toEqual(
      [...PRODUCTION_ROUTES].sort(),
    )
  })

  it('carries no design-review surface', () => {
    for (const route of ROUTES) {
      expect(route.path).not.toMatch(/concept/)
      expect(route.path).not.toMatch(/foundation/)
    }

    // And no alias quietly resolves to one either.
    for (const removed of [
      '#/foundation',
      '#/concept/point-a',
      '#/concept/point-b',
      '#/concept/admin',
      '#/concept/reporting',
    ]) {
      expect(matchRoute(removed)).toBeNull()
    }
  })

  it('keeps the capture terminals free of station navigation', () => {
    /*
     * A row of links to other stations above a half-filled registration form
     * is a mis-tap that loses somebody's data.
     */
    for (const path of ['/a', '/b'] as const) {
      const route = ROUTES.find((entry) => entry.path === path)
      expect(route?.chrome).toBe('minimal')
      // Still listed: minimal chrome hides the row, not the route.
      expect(route?.showInNav).toBe(true)
    }
  })

  it('gives Device Admin the full shell', () => {
    const admin = ROUTES.find((route) => route.path === '/admin')

    // Omitted means the shell's default, which is the full navigation.
    expect(admin?.chrome).toBeUndefined()
    expect(admin?.showInNav).toBe(true)
  })

  it('keeps Reporting and Home out of the station navigation', () => {
    /*
     * Reporting is the only screen that shows every participant's contact
     * details, and a device on a desk should not have it one mis-tap away.
     * Home is where a device starts, not somewhere an operator navigates back
     * to mid-shift.
     */
    for (const path of ['/reporting', '/'] as const) {
      expect(ROUTES.find((route) => route.path === path)?.showInNav).toBe(false)
    }
  })

  it('resolves every production route and nothing else', () => {
    for (const path of PRODUCTION_ROUTES) {
      expect(matchRoute(`#${path}`)).toBe(path)
    }
    for (const unknown of ['#/nope', '#/a/b', '#/reporting/export']) {
      expect(matchRoute(unknown)).toBeNull()
    }
  })
})
