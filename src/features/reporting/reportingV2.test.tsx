import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReportingScreen } from './ReportingScreen'

/*
 * The V2 Reporting workspace, asserted against a stubbed central server.
 *
 * `ReportingScreen.test.tsx` owns the privacy properties: where the secret
 * lives, what a 401 destroys, what reaches browser storage. This file owns what
 * the screen *says* about the run it is reading, which is the other half of
 * being trustworthy: a figure with no snapshot attached to it, or a direct
 * respondent filed as a fault, is wrong in a way no security test would catch.
 *
 * Everything here is a fixture. No real event data is read, and every
 * participant is invented: `@example.test` is reserved by RFC 6761 and can
 * never belong to a real person.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SECRET = 'c'.repeat(64)

const COUNTS = {
  registrationCount: 1284,
  feedbackCount: 1109,
  matchedRegistrations: 1053,
  registrationsWithoutFeedback: 227,
  registrationsWithMultipleFeedback: 4,
  matchedFeedback: 1053,
  feedbackWithoutRegistration: 3,
  standaloneFeedback: 37,
  feedbackIdentityConflicts: 1,
  feedbackInMultipleGroups: 15,
  duplicateRegistrationCandidateCount: 6,
}

const RUN = {
  runId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  eventId: 'evt-test',
  engineVersion: 'reconciliation-v2',
  startedAt: '2026-08-23T11:50:00.000Z',
  completedAt: '2026-08-23T11:56:00.000Z',
  counts: COUNTS,
}

/** Four questions on 1-7, with distributions that produce the stated averages. */
const RATINGS = [
  {
    key: 'testRideExperience',
    prompt: 'How was your test ride experience of Flying Flea motorcycle?',
    average: 6.12,
    responses: 1058,
    distribution: { 1: 4, 2: 7, 3: 18, 4: 46, 5: 148, 6: 371, 7: 464 },
  },
  {
    key: 'rotaryKnobUsage',
    prompt: 'How do you rate usage of the rotary knob for changing modes?',
    average: 5.3,
    responses: 1041,
    distribution: { 1: 12, 2: 26, 3: 61, 4: 137, 5: 292, 6: 331, 7: 182 },
  },
  {
    key: 'rideModesExperience',
    prompt: 'How do you rate the ride experience in different ride modes?',
    average: 5.8,
    responses: 1047,
    distribution: { 1: 6, 2: 11, 3: 29, 4: 79, 5: 214, 6: 388, 7: 320 },
  },
  {
    key: 'overallExperienceRating',
    prompt: 'How would you rate your overall experience?',
    /* A zero bucket, deliberately: it must render as an empty well rather
       than vanish, so a reader can tell "nobody chose 1" from missing UI. */
    average: 6.23,
    responses: 1055,
    distribution: { 1: 0, 2: 5, 3: 14, 4: 38, 5: 121, 6: 359, 7: 515 },
  },
]

const OVERVIEW = {
  eventId: 'evt-test',
  run: RUN,
  isHistoricalRun: false,
  freshness: {
    dataChangedSinceRun: false,
    currentRegistrationCount: 1284,
    currentFeedbackCount: 1109,
    registrationsAddedSinceRun: 0,
    feedbackAddedSinceRun: 0,
    latestContentChangeAt: '2026-08-23T11:40:00.000Z',
  },
  analytics: {
    analysedResponses: 27,
    averageOverallRating: 4.07,
    ratingCounts: { '1': 1, '2': 2, '3': 4, '4': 9, '5': 11 },
    experienceCounts: { very_poor: 1, poor: 2, okay: 5, good: 9, excellent: 10 },
    recommendYes: 24,
    recommendNo: 3,
    recommendPercentage: 88.9,
    unreadableFormVersions: 0,
  },
  campaignAnalytics: {
    formVersion: 'flying-flea-feedback-v1',
    analysedResponses: 1058,
    unreadableFormVersions: 0,
    ratings: RATINGS,
    textAnswers: { topThreeFeatures: 612, overallExperienceComments: 488 },
  },
  /* matched (1053) + standalone (37) = 1090, split across questionnaires. */
  responsesByFormVersion: {
    'flying-flea-feedback-v1': 1058,
    'feedback-v1': 27,
    'feedback-v2-draft': 5,
  },
  unreadableResponses: 5,
  coverage: {
    registrationsWithFeedback: 1057,
    totalRegistrations: 1284,
    percentage: 82.3,
    directResponses: 37,
  },
}

const DIRECT_RESPONDENT = 'Meera Subramanian'
const CODELESS_RESPONSE = '55555555-5555-4555-8555-555555555555'

const FEEDBACK_ROWS = [
  {
    recordId: '44444444-4444-4444-8444-444444444444',
    publicCode: 'A1-27CBAF-00104-6',
    participantId: '99999999-9999-4999-8999-999999999999',
    captureMethod: 'qr',
    formVersion: 'flying-flea-feedback-v1',
    createdAt: '2026-08-23T06:22:00.000Z',
    revision: 1,
    reconciliationStatus: 'matched',
    matchMethod: 'qr_identity',
    overallRating: null,
    experience: null,
    recommend: null,
    campaignSummary: {
      testRideExperience: 7,
      rotaryKnobUsage: 6,
      rideModesExperience: 7,
      overallExperienceRating: 7,
    },
    respondentName: null,
    respondentPhone: null,
    respondentEmail: null,
    linkedRegistration: {
      recordId: '22222222-2222-4222-8222-222222222222',
      publicCode: 'A1-27CBAF-00104-6',
      name: 'Ananya Raghunathan',
    },
  },
  {
    /* A direct response: no code, no registration, and nothing wrong. */
    recordId: CODELESS_RESPONSE,
    publicCode: null,
    participantId: null,
    captureMethod: 'contact',
    formVersion: 'flying-flea-feedback-v1',
    createdAt: '2026-08-23T06:44:00.000Z',
    revision: 1,
    reconciliationStatus: 'standalone',
    matchMethod: null,
    overallRating: null,
    experience: null,
    recommend: null,
    campaignSummary: {
      testRideExperience: 6,
      rotaryKnobUsage: 5,
      rideModesExperience: 6,
      overallExperienceRating: 6,
    },
    respondentName: DIRECT_RESPONDENT,
    respondentPhone: '90000 20031',
    respondentEmail: 'meera.subramanian@example.test',
    linkedRegistration: null,
  },
  {
    /* Legacy questionnaire: a bare number on a different scale. */
    recordId: '66666666-6666-4666-8666-666666666666',
    publicCode: 'A1-27CBAF-00088-2',
    participantId: '77777777-7777-4777-8777-777777777777',
    captureMethod: 'qr',
    formVersion: 'feedback-v1',
    createdAt: '2026-08-23T05:11:00.000Z',
    revision: 1,
    reconciliationStatus: 'matched',
    matchMethod: 'qr_identity',
    overallRating: 4,
    experience: 'good',
    recommend: true,
    campaignSummary: null,
    respondentName: null,
    respondentPhone: null,
    respondentEmail: null,
    linkedRegistration: {
      recordId: '88888888-8888-4888-8888-888888888888',
      publicCode: 'A1-27CBAF-00088-2',
      name: 'Farhan Qureshi',
    },
  },
]

const REGISTRATION_ROW = {
  recordId: '22222222-2222-4222-8222-222222222222',
  participantId: '99999999-9999-4999-8999-999999999999',
  publicCode: 'A1-27CBAF-00104-6',
  name: 'Ananya Raghunathan',
  phone: '90000 10104',
  email: 'ananya.raghunathan@example.test',
  vehicle: 'Vehicle 2',
  interestedColour: 'Flea Green',
  location: 'Richardson & Cruddas',
  gender: 'Female',
  testRideAt: '2026-08-23T11:20',
  pincode: '400001',
  createdAt: '2026-08-23T05:48:00.000Z',
  revision: 1,
  reconciliationStatus: 'matched',
  validFeedbackCount: 1,
  potentialDuplicate: false,
  feedbackSummary: { overallRating: null, experience: null, recommend: null },
}

const DUPLICATES = {
  run: RUN,
  candidates: [
    {
      matchBasis: 'phone_and_email',
      left: {
        recordId: 'd1',
        publicCode: 'A1-27CBAF-00106-9',
        name: 'Devika Nair',
        phone: '90000 10106',
        email: 'devika.nair@example.test',
      },
      right: {
        recordId: 'd2',
        publicCode: 'A1-27CBAF-00142-3',
        name: 'Devika S Nair',
        phone: '90000 10106',
        email: 'devika.nair@example.test',
      },
    },
    {
      matchBasis: 'phone_only',
      left: {
        recordId: 'd3',
        publicCode: 'A1-27CBAF-00108-1',
        name: 'Priya Balasubramanian',
        phone: '90000 10108',
        email: 'priya.b@example.test',
      },
      right: {
        recordId: 'd4',
        publicCode: 'A1-27CBAF-00155-7',
        name: 'Ganesh Balasubramanian',
        phone: '90000 10108',
        email: 'ganesh.b@example.test',
      },
    },
    {
      matchBasis: 'email_only',
      left: {
        recordId: 'd5',
        publicCode: 'A1-27CBAF-00120-1',
        name: 'Arjun Pillai',
        phone: '90000 10120',
        email: 'arjun.pillai@example.test',
      },
      right: {
        recordId: 'd6',
        publicCode: 'A1-27CBAF-00131-9',
        name: 'Arjun R Pillai',
        phone: '90000 10131',
        email: 'arjun.pillai@example.test',
      },
    },
  ],
  totalCandidates: 6,
  truncated: true,
}

let container: HTMLDivElement
let root: Root
let overviewBody: unknown = OVERVIEW
/** Every request the screen made, so a URL can be inspected for a secret. */
let requests: { url: string; init: RequestInit | undefined }[] = []
let reconciled = false

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function respond(input: unknown, init?: RequestInit): Response {
  const url = String(input)
  requests.push({ url, init })

  if (url.includes('/runs')) {
    return json({ runs: [RUN] })
  }
  if (url.includes('/overview')) {
    return json(overviewBody)
  }
  if (url.includes('/reconcile')) {
    reconciled = true
    return json({ runId: RUN.runId, completedAt: RUN.completedAt, counts: COUNTS })
  }
  if (url.includes('/registrations/query')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { status?: string }
    return json({
      run: RUN,
      rows: body.status === 'without_feedback' ? [] : [REGISTRATION_ROW],
      nextCursor: 'cursor-2',
      pageSize: 50,
    })
  }
  if (url.includes('/registrations/')) {
    return json({
      run: RUN,
      registration: {
        ...REGISTRATION_ROW,
        drivingLicence: 'MH0120260001042',
        eventId: 'evt-test',
        eventDay: '2026-08-23',
        stationId: 'A1',
        sourceDeviceId: 'device-a',
        lastUploaderDeviceId: 'device-a',
        updatedAt: '2026-08-23T05:48:00.000Z',
        feedback: [FEEDBACK_ROWS[0]],
      },
    })
  }
  if (url.includes('/feedback/query')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { status?: string }
    const rows =
      body.status === undefined
        ? FEEDBACK_ROWS
        : FEEDBACK_ROWS.filter((row) => row.reconciliationStatus === body.status)
    return json({ run: RUN, rows, nextCursor: null, pageSize: 50 })
  }
  if (url.includes('/feedback/')) {
    return json({
      run: RUN,
      feedback: {
        ...FEEDBACK_ROWS[1],
        eventId: 'evt-test',
        eventDay: '2026-08-23',
        stationId: 'B1',
        sourceDeviceId: 'device-b',
        lastUploaderDeviceId: 'device-b',
        updatedAt: '2026-08-23T06:44:00.000Z',
        answers: {
          testRideExperience: 6,
          overallExperienceComments:
            'Walked past the stand and asked for a go. Glad I did.',
        },
        diagnostics: null,
      },
    })
  }
  if (url.includes('/duplicates')) {
    return json(DUPLICATES)
  }
  if (url.includes('/export')) {
    return new Response('col\nvalue\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="evt-test-report-2026-08-23.xlsx"',
      },
    })
  }
  return json({})
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Sends the sequence a real pointer sends, which some controls need. */
async function click(label: string): Promise<void> {
  await act(async () => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === label,
    )
    button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

async function clickRow(index: number): Promise<void> {
  await act(async () => {
    const row = container.querySelectorAll('tbody tr')[index]
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
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

async function open(): Promise<void> {
  await act(async () => {
    root.render(<ReportingScreen />)
  })
  await signIn()
}

/** Everything rendered, including a Sheet's portalled content. */
function screenText(): string {
  return document.body.textContent ?? ''
}

beforeEach(() => {
  overviewBody = OVERVIEW
  requests = []
  reconciled = false
  vi.stubEnv('VITE_SYNC_API_BASE_URL', 'https://central.example/api')
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => Promise.resolve(respond(input, init))),
  )
  /*
   * jsdom implements neither object URLs nor navigation, so the download
   * boundary is stubbed rather than performed. The methods are replaced, not
   * the `URL` global: replacing the whole object removes the constructor that
   * the router and the reporting client both need.
   */
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------ *
 * The route, and the snapshot
 * ------------------------------------------------------------------ */

describe('the reporting route', () => {
  it('stays out of the station navigation', async () => {
    const { ROUTES } = await import('../../app/routes')
    const reporting = ROUTES.find((route) => route.path === '/reporting')

    expect(reporting).toBeDefined()
    expect(reporting?.showInNav).toBe(false)
  })
})

describe('the snapshot rail', () => {
  it('names a current run and carries its identity', async () => {
    await open()

    expect(screenText()).toContain('Current snapshot')
    expect(screenText()).toContain('1,284 registrations')
    expect(screenText()).toContain('1,109 responses')
    expect(screenText()).not.toContain('Historical snapshot')
  })

  it('names a historical run in words, and does not call it an error', async () => {
    overviewBody = { ...OVERVIEW, isHistoricalRun: true }
    await open()

    expect(screenText()).toContain('Historical snapshot')
    // Words, not just amber: this screen is read in a venue office.
    expect(screenText()).toContain('valid evidence, not an error')
  })

  it('reports staleness from the server, never from a client comparison', async () => {
    overviewBody = {
      ...OVERVIEW,
      freshness: {
        ...OVERVIEW.freshness,
        dataChangedSinceRun: true,
        registrationsAddedSinceRun: 12,
        feedbackAddedSinceRun: 9,
      },
    }
    await open()

    expect(screenText()).toContain('Event data changed since this snapshot')
    expect(screenText()).toContain('12 registration(s)')
    expect(screenText()).toContain('9 response(s)')
  })

  it('keeps the stale warning above the sections, on every section', async () => {
    overviewBody = {
      ...OVERVIEW,
      freshness: { ...OVERVIEW.freshness, dataChangedSinceRun: true },
    }
    await open()

    for (const section of ['Participants', 'Responses', 'Duplicates', 'Export']) {
      await click(section)
      expect(screenText()).toContain('Event data changed since this snapshot')
    }
  })

  it('strengthens the stale warning on Export, where a file is about to exist', async () => {
    overviewBody = {
      ...OVERVIEW,
      freshness: { ...OVERVIEW.freshness, dataChangedSinceRun: true },
    }
    await open()

    expect(screenText()).not.toContain('A file downloaded now describes')

    await click('Export')
    expect(screenText()).toContain('A file downloaded now describes')
    expect(screenText()).toContain('Reconcile first for a current final report')
  })

  it('returns to the latest run after a successful reconciliation', async () => {
    await open()
    await click('Run reconciliation')

    expect(reconciled).toBe(true)
    // Latest carries no run id: the server resolves which run that is.
    const overviewCalls = requests.filter((request) =>
      request.url.includes('/overview'),
    )
    expect(overviewCalls.length).toBeGreaterThan(1)
    expect(overviewCalls[overviewCalls.length - 1]?.url).not.toContain(RUN.runId)
  })
})

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

describe('the overview', () => {
  it('reports coverage as the server computes it', async () => {
    await open()

    expect(screenText()).toContain('82.3%')
    expect(screenText()).toContain('1,057 of 1,284 registered riders')
    expect(screenText()).toContain('227')
  })

  it('keeps direct feedback out of the coverage fraction', async () => {
    await open()

    expect(screenText()).toContain('Outside registration coverage')
    // 1,057 + 37 would be 1,094. That figure must appear nowhere.
    expect(screenText()).not.toContain('1,094')
    expect(screenText()).toContain('37')
  })

  it('states the analysis base without recomputing it', async () => {
    await open()

    // 1058 + 27 + 5, the server's own per-questionnaire tally over
    // matched + standalone. Nothing here re-derives it from the raw counts.
    expect(screenText()).toContain('1,090')
    expect(screenText()).toContain('Analysis base')
    expect(screenText()).toContain('Registration coverage')
    // The one figure that would hide the difference between them.
    expect(screenText()).not.toContain('Response rate')
  })

  it('lists each questionnaire separately and never combines their scales', async () => {
    await open()

    expect(screenText()).toContain('flying-flea-feedback-v1')
    expect(screenText()).toContain('feedback-v1')
    expect(screenText()).toContain('Two questionnaires are never averaged together')

    // Both scales are named wherever an average appears.
    expect(screenText()).toContain('/ 7')
    expect(screenText()).toContain('/ 5')
    // The campaign average and the legacy average are different numbers in
    // different sections; neither is presented as the other's.
    expect(screenText()).toContain('4.07')
    expect(screenText()).toContain('6.12')
  })

  it('says unreadable responses were excluded rather than guessed at', async () => {
    await open()

    expect(screenText()).toContain('cannot interpret')
    expect(screenText()).toContain('remain available individually and in exports')
  })

  it('renders every 1-7 bucket exactly as the server reported it', async () => {
    await open()

    const first = RATINGS[0]
    expect(first).toBeDefined()
    for (const value of [1, 2, 3, 4, 5, 6, 7] as const) {
      const count = first?.distribution[value] ?? 0
      expect(screenText()).toContain(count.toLocaleString())
    }

    // A zero bucket still draws its well, so "nobody chose 1" is visibly
    // different from a column that failed to render.
    const wells = container.querySelectorAll('[aria-hidden="true"].h-14')
    expect(wells.length).toBe(RATINGS.length * 7)
  })

  it('shows text answer counts and claims nothing about what they said', async () => {
    await open()

    expect(screenText()).toContain('612')
    expect(screenText()).toContain('488')
    expect(screenText()).toContain('does not summarise it')
    for (const invented of ['Sentiment', 'Themes', 'Summary of comments']) {
      expect(screenText()).not.toContain(invented)
    }
  })

  it('does not colour incomplete coverage as corrupted evidence', async () => {
    await open()

    expect(screenText()).toContain('Registered participants with no response')
    expect(screenText()).toContain('Coverage that is incomplete, not data that is wrong')
  })
})

/* ------------------------------------------------------------------ *
 * Participants
 * ------------------------------------------------------------------ */

describe('participants', () => {
  it('sends the search in the request body, never in a URL', async () => {
    await open()
    await click('Participants')

    const input = container.querySelector<HTMLInputElement>('#registration-search')
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    setter?.call(input, '90000 10104')
    input?.dispatchEvent(new Event('input', { bubbles: true }))

    await act(async () => {
      input
        ?.closest('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()

    const queries = requests.filter((request) =>
      request.url.includes('/registrations/query'),
    )
    expect(queries.length).toBeGreaterThan(1)
    const last = queries[queries.length - 1]
    expect(String(last?.init?.body)).toContain('90000 10104')
    // Not in the URL, the address bar, or the document title.
    expect(last?.url).not.toContain('90000')
    expect(window.location.href).not.toContain('90000')
    expect(document.title).not.toContain('90000')
  })

  it('keeps its four status filters and asks the server for them', async () => {
    await open()
    await click('Participants')

    for (const label of ['All', 'Matched', 'No response', 'Several responses']) {
      const button = [...container.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === label,
      )
      expect(`${label}: ${button !== undefined}`).toBe(`${label}: true`)
    }

    await click('No response')
    const queries = requests.filter((request) =>
      request.url.includes('/registrations/query'),
    )
    expect(String(queries[queries.length - 1]?.init?.body)).toContain(
      'without_feedback',
    )
  })

  it('claims no rating where the questionnaire does not carry one', async () => {
    await open()
    await click('Participants')

    /*
     * `feedbackSummary.overallRating` is the legacy questionnaire's field and
     * is null under the campaign one. "rated none" there would say a rider
     * skipped a question they answered on a different scale.
     */
    expect(screenText()).not.toContain('rated none')
    expect(screenText()).toContain('Ananya Raghunathan')
  })

  it('pages with the server cursor', async () => {
    await open()
    await click('Participants')

    expect(screenText()).toContain('more available')
    await click('Load more')

    const queries = requests.filter((request) =>
      request.url.includes('/registrations/query'),
    )
    expect(String(queries[queries.length - 1]?.init?.body)).toContain('cursor-2')
  })

  it('opens a read-only detail Sheet without moving the table', async () => {
    await open()
    await click('Participants')
    await clickRow(0)

    const sheet = document.querySelector('[role="dialog"]')
    expect(sheet).not.toBeNull()
    expect(sheet?.textContent).toContain('Ananya Raghunathan')
    expect(sheet?.textContent).toContain('Read only')
    // The sensitive field this view alone is allowed to show.
    expect(sheet?.textContent).toContain('MH0120260001042')

    // The table is still exactly where it was, not pushed down by a panel.
    expect(container.querySelector('table')).not.toBeNull()

    for (const forbidden of ['Edit', 'Merge', 'Delete', 'Reassign', 'Correct']) {
      const button = [...document.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === forbidden,
      )
      expect(`${forbidden}: ${button === undefined}`).toBe(`${forbidden}: true`)
    }
    expect(sheet?.querySelector('input:not([type="search"])')).toBeNull()
    expect(sheet?.querySelector('textarea')).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * Responses
 * ------------------------------------------------------------------ */

describe('responses', () => {
  it('keeps no-registration and direct feedback as different filters', async () => {
    await open()
    await click('Responses')

    const labels = [...container.querySelectorAll('button')].map(
      (button) => button.textContent,
    )
    expect(labels).toContain('No registration')
    expect(labels).toContain('Direct feedback')
  })

  it('treats a direct response as ordinary, not as a fault', async () => {
    await open()
    await click('Responses')

    expect(screenText()).toContain(DIRECT_RESPONDENT)
    // Said in words rather than left blank: a contact response never had a
    // sticker, and an empty cell reads as a code that failed to load.
    expect(screenText()).toContain('No code')

    const pill = [...container.querySelectorAll('td span')].find(
      (span) => span.textContent === 'Direct feedback',
    )
    expect(pill).toBeDefined()
    expect(pill?.className).toContain('text-muted')
    expect(pill?.className).not.toContain('text-danger')
    expect(pill?.className).not.toContain('text-warn')
  })

  it('reads the rating on each response own questionnaire terms', async () => {
    await open()
    await click('Responses')

    // Flying Flea carries its scale; the legacy questionnaire is a bare number.
    expect(screenText()).toContain('7 / 7')
    expect(screenText()).toContain('6 / 7')
    const cells = [...container.querySelectorAll('tbody td')].map(
      (cell) => cell.textContent,
    )
    expect(cells).toContain('4')
  })

  it('opens a read-only response Sheet with the answers as recorded', async () => {
    await open()
    await click('Responses')
    await clickRow(1)

    const sheet = document.querySelector('[role="dialog"]')
    expect(sheet?.textContent).toContain('Read only')
    expect(sheet?.textContent).toContain('Details given by the rider')
    expect(sheet?.textContent).toContain('meera.subramanian@example.test')
    // A long free-text answer is shown in full, not truncated away.
    expect(sheet?.textContent).toContain('Walked past the stand')
    // And the status explains itself rather than reading as a failure.
    expect(sheet?.textContent).toContain('expected outcome for the contact path')

    for (const forbidden of ['Edit', 'Reassign', 'Delete', 'Link']) {
      const button = [...document.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === forbidden,
      )
      expect(`${forbidden}: ${button === undefined}`).toBe(`${forbidden}: true`)
    }
  })
})

/* ------------------------------------------------------------------ *
 * Needs review and Duplicates
 * ------------------------------------------------------------------ */

describe('needs review', () => {
  it('offers no way to resolve, dismiss or merge anything', async () => {
    await open()
    await click('Needs review')

    for (const forbidden of [
      'Resolve',
      'Ignore',
      'Dismiss',
      'Mark handled',
      'Link participant',
      'Merge',
    ]) {
      const button = [...document.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === forbidden,
      )
      expect(`${forbidden}: ${button === undefined}`).toBe(`${forbidden}: true`)
    }

    expect(screenText()).toContain('Nothing here can be merged, linked, deleted or marked')
  })

  it('has no direct feedback category', async () => {
    await open()
    await click('Needs review')

    const group = [...container.querySelectorAll('[role="group"]')].find(
      (element) => element.getAttribute('aria-label') === 'Anomaly type',
    )
    expect(group).toBeDefined()
    expect(group?.textContent).not.toContain('Direct feedback')
    expect(group?.textContent).toContain('Codes that matched no registration')
  })

  it('does not offer a second status control that could disagree with the category', async () => {
    await open()
    await click('Needs review')

    const groups = [...container.querySelectorAll('[role="group"]')].map((element) =>
      element.getAttribute('aria-label'),
    )
    expect(groups).toContain('Anomaly type')
    expect(groups).not.toContain('Filter by status')
  })

  it('takes its counts from the overview already loaded', async () => {
    await open()
    const before = requests.length
    await click('Needs review')

    const group = [...container.querySelectorAll('[role="group"]')].find(
      (element) => element.getAttribute('aria-label') === 'Anomaly type',
    )
    // The run's own counts, on the controls.
    expect(group?.textContent).toContain('3')
    expect(group?.textContent).toContain('227')

    // No extra endpoint was invented to put them there: the only new requests
    // are the filtered browser's own query.
    const added = requests.slice(before).map((request) => request.url)
    expect(added.every((url) => url.includes('/query'))).toBe(true)
  })
})

describe('duplicates', () => {
  it('shows the match basis for each pair and offers no merge', async () => {
    await open()
    await click('Duplicates')

    expect(screenText()).toContain('Same phone and email')
    expect(screenText()).toContain('Same phone')
    expect(screenText()).toContain('Same email')
    expect(screenText()).toContain('Names are never matched on')
    expect(screenText()).toContain('Merging is not available')

    for (const forbidden of ['Merge', 'Delete', 'Confirm', 'Not a duplicate']) {
      const button = [...document.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === forbidden,
      )
      expect(`${forbidden}: ${button === undefined}`).toBe(`${forbidden}: true`)
    }
  })

  it('keeps the truncation warning and points at the CSV', async () => {
    await open()
    await click('Duplicates')

    expect(screenText()).toContain('Showing 3 of 6 pairs')
    expect(screenText()).toContain('never truncated')
  })
})

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

describe('export', () => {
  it('names the six sheets the workbook actually has', async () => {
    await open()
    await click('Export')

    for (const sheet of [
      'Summary',
      'Participant Feedback',
      'Registrations',
      'Feedback',
      'Duplicate Candidates',
      'Metadata',
    ]) {
      expect(screenText()).toContain(sheet)
    }
    expect(screenText()).toContain('Six sheets in one workbook')
  })

  it('keeps every export kind', async () => {
    await open()
    await click('Export')

    expect(screenText()).toContain('Full workbook (XLSX)')
    expect(screenText()).toContain('Participants (CSV)')
    expect(screenText()).toContain('Responses (CSV)')
    expect(screenText()).toContain('Possible duplicates (CSV)')
  })

  it('states the PII risk before any download is offered', async () => {
    await open()
    await click('Export')

    expect(screenText()).toContain('These files contain participant contact details')
    expect(screenText()).toContain('leave this protected workspace')
  })

  it('never puts the credential in a URL', async () => {
    await open()
    await click('Export')
    await click('Download workbook')

    const exports = requests.filter((request) => request.url.includes('/export'))
    expect(exports.length).toBeGreaterThan(0)
    for (const request of exports) {
      expect(request.url).not.toContain(SECRET)
      expect(request.url).not.toContain('secret')
      expect(request.url).not.toContain('token')
      // It travels in the header, which is the only place it can.
      const headers = new Headers(request.init?.headers)
      expect(headers.get('Authorization')).toBe(`Bearer ${SECRET}`)
    }
  })

  it('reports the filename it handed to the browser', async () => {
    await open()
    await click('Export')
    await click('Download workbook')

    expect(screenText()).toContain('Downloaded evt-test-report-2026-08-23.xlsx')
    // No claim about where it went: the browser decides that, not this screen.
    expect(screenText()).not.toContain('saved to your Downloads')
  })
})

/* ------------------------------------------------------------------ *
 * Session teardown
 * ------------------------------------------------------------------ */

describe('when the session ends', () => {
  it('takes an open detail Sheet and its contact details with it', async () => {
    await open()
    await click('Responses')
    await clickRow(1)

    const sheet = document.querySelector('[role="dialog"]')
    expect(sheet?.textContent).toContain('meera.subramanian@example.test')

    await click('Sign out')

    /*
     * A Sheet portals its content to the document body, so this is the check
     * that matters: the panel is unmounted with the workspace rather than left
     * floating over the sign-in form with a rider's phone number on it.
     */
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.textContent).not.toContain('meera.subramanian@example.test')
    expect(document.body.textContent).not.toContain(DIRECT_RESPONDENT)
    expect(container.querySelector('#reporting-secret')).not.toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * Structure
 * ------------------------------------------------------------------ */

describe('structure', () => {
  it('gives every table a caption and scoped headings', async () => {
    await open()
    await click('Participants')

    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    const headers = [...(table?.querySelectorAll('th') ?? [])]
    expect(headers.length).toBeGreaterThan(0)
    for (const header of headers) {
      expect(header.getAttribute('scope')).toBe('col')
    }
  })

  it('offers a section picker for a narrow viewport as well as tabs', async () => {
    await open()

    // Both are rendered; CSS decides which is visible. The picker is a real
    // labelled control rather than six tabs compressed past legibility.
    expect(container.querySelector('#reporting-section')).not.toBeNull()
    const label = [...container.querySelectorAll('label')].find(
      (element) => element.getAttribute('for') === 'reporting-section',
    )
    expect(label?.textContent).toBe('Reporting section')
  })

  it('announces the result count as it changes', async () => {
    await open()
    await click('Participants')

    const live = [...container.querySelectorAll('[aria-live="polite"]')]
    expect(live.length).toBeGreaterThan(0)
    expect(live.some((element) => /participant/.test(element.textContent ?? ''))).toBe(
      true,
    )
  })
})
