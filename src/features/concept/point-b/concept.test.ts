import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTES } from '@/app/routes'
import {
  RATING_QUESTIONS,
  TEXT_QUESTIONS,
} from '@/features/campaign/flying-flea/feedbackForm'

/*
 * The concept is a prototype, and this is what keeps it one.
 *
 * A design prototype that imports the real terminal stops being a prototype the
 * moment somebody wires a button up "just to see it work", and the first sign of
 * that is a feedback record in IndexedDB that no rider created, or a camera
 * light coming on during a design review. These tests make the isolation a
 * property of the build rather than of everybody remembering.
 *
 * Point B has one hazard Point A did not: a camera. `createZxingScanner` opens
 * a `MediaStream` that has to be released on unmount or the capture light stays
 * on, so the scanner module is on the forbidden list beside storage.
 */

const CONCEPT_DIR = 'src/features/concept/point-b'

function conceptSources(): { name: string; source: string }[] {
  return readdirSync(CONCEPT_DIR)
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.test.ts'))
    .map((file) => ({
      name: file,
      source: readFileSync(join(CONCEPT_DIR, file), 'utf8'),
    }))
}

/** Every import specifier the concept declares. */
function conceptImports(): { name: string; specifier: string }[] {
  return conceptSources().flatMap(({ name, source }) =>
    [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => ({
      name,
      specifier: match[1] as string,
    })),
  )
}

/** Every named binding the concept imports. */
function conceptBindings(): string[] {
  return conceptSources().flatMap(({ source }) =>
    [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap((match) =>
      (match[1] as string).split(',').map((name) => name.trim()),
    ),
  )
}

/*
 * Modules a visual prototype has no business reaching. The terminal hook is on
 * the list because it is the one import that would make every other one
 * reachable in a single line: it owns storage, the scanner and the identity
 * layer between them.
 */
const FORBIDDEN = [
  'lib/storage',
  'lib/scanner',
  'lib/sync',
  'lib/backup',
  'lib/pwa',
  'usePointBTerminal',
  'identityCapture',
  'contactCapture',
  'FeedbackScreen',
  'ContactFeedbackForm',
  'ManualCodeEntry',
]

describe('the Point B concept', () => {
  it('cannot reach storage, the scanner, or the feedback terminal', () => {
    for (const { name, specifier } of conceptImports()) {
      for (const forbidden of FORBIDDEN) {
        expect(
          specifier.includes(forbidden),
          `${name} imports ${specifier}, which a visual prototype must not touch`,
        ).toBe(false)
      }
    }
  })

  it('creates no feedback record and captures no identity', () => {
    const bindings = conceptBindings()

    for (const forbidden of [
      'createFeedback',
      'countFeedback',
      'hasFeedbackForPublicCode',
      'createZxingScanner',
      'captureIdentityFromQr',
      'captureIdentityFromManualCode',
      'validateContactCapture',
      'db',
    ]) {
      expect(bindings, `the concept imports ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('opens no camera and asks no network', () => {
    /*
     * The scanner state is a drawn fixture. A concept that opened a real camera
     * to show what a camera looks like would ask a reviewer for a permission
     * prompt in order to review a layout, and would leave the capture light on
     * if it forgot to dispose the stream.
     */
    const all = conceptSources()
      .map((file) => file.source)
      .join('\n')

    expect(all).not.toContain('getUserMedia')
    expect(all).not.toContain('mediaDevices')
    expect(all).not.toMatch(/\bfetch\s*\(/)
    expect(all).not.toContain('XMLHttpRequest')
    expect(all).not.toContain('navigator.onLine')
  })

  it('reads the campaign’s own questions rather than retyping them', () => {
    /*
     * The single source of truth, checked as a fact rather than as a comment.
     * A question that exists in two places is a question that will eventually
     * disagree with itself, and the disagreement is invisible: one rider shown
     * a subtly different wording from the rider before them, both answers
     * stored under one form version claiming they were asked the same thing.
     */
    const all = conceptSources()
      .map((file) => file.source)
      .join('\n')

    expect(all).toContain('RATING_QUESTIONS')
    expect(all).toContain('TEXT_QUESTIONS')

    for (const question of [...RATING_QUESTIONS, ...TEXT_QUESTIONS]) {
      expect(
        all.includes(question.prompt),
        `the concept hardcodes the prompt "${question.prompt}"`,
      ).toBe(false)
    }
  })

  it('asks exactly the six questions the campaign defines', () => {
    expect(RATING_QUESTIONS).toHaveLength(4)
    expect(TEXT_QUESTIONS).toHaveLength(2)
  })

  it('did not replace the production feedback screen', () => {
    const pointB = ROUTES.find((route) => route.path === '/b')

    expect(pointB).toBeDefined()
    expect(pointB?.title).toBe('Point B: Feedback')
    expect(pointB?.showInNav).toBe(true)
    expect(pointB?.path).not.toBe('/concept/point-b')
  })

  it('is unlisted, minimal-chrome and on its own path', () => {
    const concept = ROUTES.find((route) => route.path === '/concept/point-b')

    expect(concept).toBeDefined()
    expect(concept?.showInNav).toBe(false)
    expect(concept?.chrome).toBe('minimal')
    expect(concept?.context).toBe('Point B · Feedback')
  })
})
