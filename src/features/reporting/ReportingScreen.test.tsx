import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReportingScreen } from './ReportingScreen'
import { db } from '../../lib/storage'

/*
 * Reporting's privacy properties, asserted at the screen level.
 *
 * The rule this suite defends: central report data, and the credential that
 * fetches it, exist in React state and nowhere else. A tablet or laptop that
 * has had this screen open must have nothing on disk to recover afterwards.
 */

// React only treats act() as authoritative when the environment declares itself.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SECRET = 'b'.repeat(64)

const RUN = {
  runId: '11111111-1111-4111-8111-111111111111',
  eventId: 'evt-dev-001',
  engineVersion: 'reconciliation-v1',
  startedAt: '2026-02-01T07:59:00.000Z',
  completedAt: '2026-02-01T08:00:00.000Z',
  counts: {
    registrationCount: 1,
    feedbackCount: 1,
    matchedRegistrations: 1,
    registrationsWithoutFeedback: 0,
    registrationsWithMultipleFeedback: 0,
    matchedFeedback: 1,
    feedbackWithoutRegistration: 0,
    standaloneFeedback: 0,
    feedbackIdentityConflicts: 0,
    feedbackInMultipleGroups: 0,
    duplicateRegistrationCandidateCount: 0,
  },
}

const OVERVIEW = {
  eventId: 'evt-dev-001',
  run: RUN,
  isHistoricalRun: false,
  freshness: {
    dataChangedSinceRun: false,
    currentRegistrationCount: 1,
    currentFeedbackCount: 1,
    registrationsAddedSinceRun: 0,
    feedbackAddedSinceRun: 0,
    latestContentChangeAt: '2026-02-01T07:58:00.000Z',
  },
  analytics: {
    analysedResponses: 1,
    averageOverallRating: 5,
    ratingCounts: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 1 },
    experienceCounts: {
      very_poor: 0,
      poor: 0,
      okay: 0,
      good: 0,
      excellent: 1,
    },
    recommendYes: 1,
    recommendNo: 0,
    recommendPercentage: 100,
    unreadableFormVersions: 0,
  },
  campaignAnalytics: {
    formVersion: 'flying-flea-feedback-v1',
    analysedResponses: 0,
    unreadableFormVersions: 0,
    ratings: [],
    textAnswers: { topThreeFeatures: 0, overallExperienceComments: 0 },
  },
  responsesByFormVersion: { 'feedback-v1': 1 },
  unreadableResponses: 0,
  coverage: {
    registrationsWithFeedback: 1,
    totalRegistrations: 1,
    percentage: 100,
    directResponses: 0,
  },
}

/** A distinctive value: if it reaches storage, a search will find it. */
const PARTICIPANT_NAME = 'Zzyzx Quibblesworth'

const REGISTRATIONS = {
  run: RUN,
  rows: [
    {
      recordId: '22222222-2222-4222-8222-222222222222',
      participantId: '33333333-3333-4333-8333-333333333333',
      publicCode: 'A1-B8EFD9-00001-X',
      name: PARTICIPANT_NAME,
      phone: '+919876543210',
      email: 'zzyzx@example.com',
      vehicle: 'Vehicle 2',
      interestedColour: 'Storm Black',
      location: 'Prestige Tech Park',
      gender: 'Female',
      testRideAt: '2026-02-01T10:30',
      pincode: '560048',
      createdAt: '2026-02-01T07:00:00.000Z',
      revision: 1,
      reconciliationStatus: 'matched',
      validFeedbackCount: 1,
      potentialDuplicate: false,
      feedbackSummary: { overallRating: 5, experience: 'excellent', recommend: true },
    },
  ],
  nextCursor: null,
  pageSize: 50,
}

let container: HTMLDivElement
let root: Root

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Flipped mid-test to simulate a secret rotated or revoked on the server. */
let rejectEverything = false
/** Swapped to test what the screen says about a historical or stale run. */
let overviewBody: unknown = OVERVIEW

function respond(input: unknown): Response {
  const url = String(input)

  if (rejectEverything) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }
  if (url.includes('/runs')) {
    return json({ runs: [RUN] })
  }
  if (url.includes('/overview')) {
    return json(overviewBody)
  }
  if (url.includes('/registrations/query')) {
    return json(REGISTRATIONS)
  }
  if (url.includes('/feedback/query')) {
    return json({ run: RUN, rows: [], nextCursor: null, pageSize: 50 })
  }
  if (url.includes('/duplicates')) {
    return json({ run: RUN, candidates: [], totalCandidates: 0, truncated: false })
  }
  return json({})
}

/** Lets the fetch promise chain settle: response -> json -> setState. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Clicks a button by its exact label, then lets its request settle. */
async function click(label: string): Promise<void> {
  await act(async () => {
    const button = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === label,
    )
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

async function signIn(): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('#reporting-secret')
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set
  setter?.call(input, SECRET)
  input?.dispatchEvent(new Event('input', { bubbles: true }))

  await act(async () => {
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush()
}

beforeEach(() => {
  rejectEverything = false
  overviewBody = OVERVIEW
  vi.stubEnv('VITE_SYNC_API_BASE_URL', 'https://central.example/api')
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => Promise.resolve(respond(input))),
  )

  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  localStorage.clear()
  sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('ReportingScreen', () => {
  it('asks for the reporting secret before showing anything', async () => {
    await act(async () => {
      root.render(<ReportingScreen />)
    })

    expect(container.querySelector('#reporting-secret')).not.toBeNull()
    expect(container.textContent).not.toContain('Event overview')
  })

  it('opens the workspace once the secret is accepted', async () => {
    await act(async () => {
      root.render(<ReportingScreen />)
    })
    await signIn()

    expect(container.textContent).toContain('Event overview')
    expect(container.querySelector('#reporting-secret')).toBeNull()
  })

  it('keeps the secret out of every browser store', async () => {
    await act(async () => {
      root.render(<ReportingScreen />)
    })
    await signIn()

    const persisted = [
      JSON.stringify(localStorage),
      JSON.stringify(sessionStorage),
      document.cookie,
    ].join('|')

    expect(persisted).not.toContain(SECRET)
    // And it is not left lying in the DOM either: the field is a password
    // input that gets cleared, and no panel echoes it back.
    expect(container.innerHTML).not.toContain(SECRET)
  })

  it('writes no central data to IndexedDB, localStorage or sessionStorage', async () => {
    await act(async () => {
      root.render(<ReportingScreen />)
    })
    await signIn()

    // Load a panel that actually returns a participant.
    await click('Participants')

    expect(container.textContent).toContain(PARTICIPANT_NAME)

    const stored = [JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join(
      '|',
    )
    expect(stored).not.toContain(PARTICIPANT_NAME)
    expect(stored).not.toContain('+919876543210')

    /*
     * The local database is the one that would survive a reboot. Reporting has
     * no table there and must not have written into anyone else's.
     */
    const localRegistrations = await db.registrations.toArray()
    const localFeedback = await db.feedback.toArray()
    expect(localRegistrations).toHaveLength(0)
    expect(localFeedback).toHaveLength(0)
  })

  it('offers the recorded runs, defaulting to the latest', async () => {
    await act(async () => {
      root.render(<ReportingScreen />)
    })
    await signIn()

    const select = container.querySelector<HTMLSelectElement>('#reporting-run')
    expect(select).not.toBeNull()
    // Latest is the default and carries no run id: the server resolves it.
    expect(select?.value).toBe('')
    expect([...(select?.options ?? [])].map((option) => option.value)).toContain(
      RUN.runId,
    )
  })

  it('destroys the session and unmounts the data when a request returns 401', async () => {
    await act(async () => {
      root.render(<ReportingScreen />)
    })
    await signIn()
    await click('Participants')

    // The screen is showing a real participant's name and phone number.
    expect(container.textContent).toContain(PARTICIPANT_NAME)
    expect(container.textContent).toContain('+919876543210')

    /*
     * The secret is rotated on the server mid-session. The next request, any
     * request, comes back 401, and from that moment nothing on screen is
     * authorised: leaving the participants visible behind an error notice would
     * be a privileged view of the event with nothing authorising it.
     */
    rejectEverything = true
    // Any request will do; this one is a status filter on the open panel.
    await click('Matched')

    // Back at the sign-in form...
    expect(container.querySelector('#reporting-secret')).not.toBeNull()
    expect(container.textContent).toContain('rejected')

    // ...with every trace of the central data gone from the document.
    expect(container.textContent).not.toContain(PARTICIPANT_NAME)
    expect(container.textContent).not.toContain('+919876543210')
    expect(container.textContent).not.toContain('zzyzx@example.com')
    expect(container.innerHTML).not.toContain(SECRET)

    // The panels themselves are unmounted, not merely emptied.
    expect(container.textContent).not.toContain('Event overview')
    expect(container.querySelector('.report-table')).toBeNull()
    expect(container.querySelector('#reporting-run')).toBeNull()

    // And nothing was left behind on the machine on the way out.
    const stored = [JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join(
      '|',
    )
    expect(stored).toBe('{}|{}')
    expect(document.cookie).toBe('')
  })

  it('does not reuse a rejected secret for the next request', async () => {
    await act(async () => {
      root.render(<ReportingScreen />)
    })
    await signIn()

    rejectEverything = true
    await click('Refresh')

    const callsBefore = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length

    // Nothing may keep polling with a credential the server has rejected.
    await act(async () => {
      await Promise.resolve()
    })
    expect(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(callsBefore)
  })

  it('warns about a historical run on every tab, not just the overview', async () => {
    overviewBody = { ...OVERVIEW, isHistoricalRun: true }

    await act(async () => {
      root.render(<ReportingScreen />)
    })
    await signIn()

    for (const tab of ['Participants', 'Responses', 'Duplicates', 'Export']) {
      await click(tab)
      expect(container.textContent).toContain('Viewing a historical run')
      // Both halves of the caveat: which parts are historical, which are current.
      expect(container.textContent).toContain('current')
    }
  })

  it('warns about a stale run everywhere, and escalates it on Export', async () => {
    overviewBody = {
      ...OVERVIEW,
      freshness: {
        ...OVERVIEW.freshness,
        dataChangedSinceRun: true,
        registrationsAddedSinceRun: 3,
        feedbackAddedSinceRun: 2,
      },
    }

    await act(async () => {
      root.render(<ReportingScreen />)
    })
    await signIn()

    await click('Participants')
    expect(container.textContent).toContain('no longer describes the event')

    await click('Export')
    expect(container.textContent).toContain('no longer describes the event')
    // The tab where acting on it matters most says so explicitly.
    expect(container.textContent).toContain('Reconcile first if this is a final report')
  })

  it('forgets the secret on sign out', async () => {
    await act(async () => {
      root.render(<ReportingScreen />)
    })
    await signIn()

    await click('Sign out')

    expect(container.querySelector('#reporting-secret')).not.toBeNull()
    expect(container.innerHTML).not.toContain(SECRET)
  })
})
