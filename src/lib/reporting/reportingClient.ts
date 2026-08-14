import { SYNC_API_BASE_URL } from '../sync/syncConfig'
import type {
  DuplicateCandidateRow,
  ExportKind,
  FeedbackDetail,
  FeedbackQueryBody,
  FeedbackRow,
  OverviewResponse,
  Page,
  ReconcileResult,
  RegistrationDetail,
  RegistrationQueryBody,
  RegistrationRow,
  RunDescriptor,
} from './types'

/*
 * The reporting HTTP boundary.
 *
 * Three rules hold everywhere in this module.
 *
 * 1. The credential lives in a function argument, never in a module variable,
 *    never in storage. The caller holds it in React state and it dies with the
 *    tab. There is no "remember me" here by design: this is the one credential
 *    that reads every participant's name, phone number and email.
 *
 * 2. Nothing is cached. `cache: 'no-store'` on the request pairs with the
 *    server's `Cache-Control: no-store, private`, and no reporting response is
 *    ever written to IndexedDB, localStorage, sessionStorage or CacheStorage.
 *
 * 3. Search terms travel in POST bodies, never in query strings. A URL ends up
 *    in access logs, history and `Referer` headers, and a search term here is
 *    frequently a participant's phone number.
 */

/**
 * Reporting is served by the same process as sync, so it shares the configured
 * base URL. It does **not** share the credential.
 *
 * Concatenation, not `new URL()`: the base may legitimately be a same-origin
 * path (`/api` in production), and `new URL('/api')` needs a base to resolve
 * against and would throw. Appending keeps `/api` → `/api/v1/reporting` and
 * `https://api.example.com` → `https://api.example.com/v1/reporting`, and the
 * browser resolves the relative form against the page's own origin — which is
 * exactly the same origin the app was served from.
 */
export const REPORTING_API_BASE_URL: string | null =
  SYNC_API_BASE_URL === null ? null : `${SYNC_API_BASE_URL}/v1/reporting`

export function isReportingConfigured(): boolean {
  return REPORTING_API_BASE_URL !== null
}

export type ReportingFailure =
  /** No central server URL was compiled into this build. */
  | 'not_configured'
  /** The server has no reporting secret. Reporting is switched off there. */
  | 'reporting_disabled'
  /** The secret was missing, wrong, or has been rotated. */
  | 'unauthorized'
  /** No reconciliation run exists yet for this event. */
  | 'no_run'
  /** The requested record is not in this event. */
  | 'not_found'
  /** The server is reachable but broke. */
  | 'server_error'
  /** Never heard back: offline, DNS, refused, dropped. */
  | 'unreachable'
  /** Abandoned after the timeout. */
  | 'timeout'
  /** The server refused the request itself. */
  | 'rejected'

export type ReportingResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ReportingFailure }

/** Exports of a whole event can be large; reads are quick. */
const READ_TIMEOUT_MS = 30_000
const EXPORT_TIMEOUT_MS = 120_000

interface RequestOptions {
  readonly secret: string
  readonly method?: 'GET' | 'POST'
  readonly body?: unknown
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

/** Maps a status code onto the failure the screen has to explain. */
function failureFor(status: number): ReportingFailure {
  if (status === 401) {
    return 'unauthorized'
  }
  if (status === 503) {
    return 'reporting_disabled'
  }
  if (status === 404) {
    return 'not_found'
  }
  if (status >= 500) {
    return 'server_error'
  }
  return 'rejected'
}

async function request(
  path: string,
  options: RequestOptions,
): Promise<ReportingResult<Response>> {
  if (REPORTING_API_BASE_URL === null) {
    return { ok: false, failure: 'not_configured' }
  }

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? READ_TIMEOUT_MS,
  )
  options.signal?.addEventListener('abort', () => controller.abort(), {
    once: true,
  })

  let response: Response
  try {
    response = await fetch(`${REPORTING_API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        // The only place the credential appears. Not a cookie: a cookie would
        // be attached automatically to requests this screen did not make.
        Authorization: `Bearer ${options.secret}`,
        ...(options.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      // Belt and braces with the server's no-store: neither the HTTP cache nor
      // a shared machine's disk should keep a copy of anyone's details.
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
    const aborted =
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    return { ok: false, failure: aborted ? 'timeout' : 'unreachable' }
  }
  clearTimeout(timer)

  if (!response.ok) {
    /*
     * 404 is overloaded: the server says `no_completed_run` when the event has
     * never been reconciled and `not_found` for an unknown record. The screens
     * need to tell those apart — one is "press Run reconciliation", the other
     * is "that record is not here".
     */
    if (response.status === 404) {
      const body = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      return {
        ok: false,
        failure: body?.error === 'no_completed_run' ? 'no_run' : 'not_found',
      }
    }

    return { ok: false, failure: failureFor(response.status) }
  }

  return { ok: true, value: response }
}

async function json<T>(
  path: string,
  options: RequestOptions,
): Promise<ReportingResult<T>> {
  const result = await request(path, options)
  if (!result.ok) {
    return result
  }

  try {
    return { ok: true, value: (await result.value.json()) as T }
  } catch {
    return { ok: false, failure: 'server_error' }
  }
}

/** Encodes an event id for a URL. Never a name, a code or a search term. */
function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value.length > 0) {
      search.set(key, value)
    }
  }
  const rendered = search.toString()
  return rendered.length === 0 ? '' : `?${rendered}`
}

export function fetchOverview(
  secret: string,
  eventId: string,
  runId?: string,
): Promise<ReportingResult<OverviewResponse>> {
  return json(`/overview${query({ eventId, runId })}`, { secret })
}

export function fetchRuns(
  secret: string,
  eventId: string,
): Promise<ReportingResult<{ runs: readonly RunDescriptor[] }>> {
  return json(`/runs${query({ eventId })}`, { secret })
}

export function queryRegistrations(
  secret: string,
  body: RegistrationQueryBody,
): Promise<ReportingResult<Page<RegistrationRow> & { run: RunDescriptor }>> {
  // POST, not GET: `body.search` may be a participant's phone number.
  return json('/registrations/query', { secret, method: 'POST', body })
}

export function queryFeedback(
  secret: string,
  body: FeedbackQueryBody,
): Promise<ReportingResult<Page<FeedbackRow> & { run: RunDescriptor }>> {
  return json('/feedback/query', { secret, method: 'POST', body })
}

export function fetchRegistrationDetail(
  secret: string,
  eventId: string,
  recordId: string,
  runId?: string,
): Promise<
  ReportingResult<{ run: RunDescriptor; registration: RegistrationDetail }>
> {
  return json(
    `/registrations/${encodeURIComponent(recordId)}${query({ eventId, runId })}`,
    { secret },
  )
}

export function fetchFeedbackDetail(
  secret: string,
  eventId: string,
  recordId: string,
  runId?: string,
): Promise<ReportingResult<{ run: RunDescriptor; feedback: FeedbackDetail }>> {
  return json(
    `/feedback/${encodeURIComponent(recordId)}${query({ eventId, runId })}`,
    { secret },
  )
}

export function fetchDuplicateCandidates(
  secret: string,
  eventId: string,
  runId?: string,
): Promise<
  ReportingResult<{
    run: RunDescriptor
    candidates: readonly DuplicateCandidateRow[]
    /** How many pairs the run found, which may exceed the page returned. */
    totalCandidates: number
    truncated: boolean
  }>
> {
  // The largest page the server allows: this list is reviewed as a whole, and
  // the response says how many pairs exist beyond it.
  return json(`/duplicates${query({ eventId, runId, limit: '100' })}`, { secret })
}

/**
 * Asks the server to run reconciliation now.
 *
 * The one action in reporting that writes anything, and it writes only a new
 * derived run — the Phase 7 engine, called unchanged. It is never automatic:
 * an operator triggers it after seeing that the data has moved.
 */
export function requestReconciliation(
  secret: string,
  eventId: string,
): Promise<ReportingResult<ReconcileResult>> {
  return json('/reconcile', {
    secret,
    method: 'POST',
    body: { eventId },
    timeoutMs: EXPORT_TIMEOUT_MS,
  })
}

export interface DownloadedExport {
  readonly blob: Blob
  readonly fileName: string
}

/**
 * Downloads an export.
 *
 * Fetched rather than linked: a plain `<a href>` cannot carry the Authorization
 * header, and the alternative — a token in the URL — would put the credential
 * into browser history and the server's access log.
 *
 * The filename comes from the server's `Content-Disposition`, which by
 * construction carries an event, a kind and a date, never a participant.
 */
export async function downloadExport(
  secret: string,
  eventId: string,
  kind: ExportKind,
  runId?: string,
): Promise<ReportingResult<DownloadedExport>> {
  const result = await request(`/export/${kind}${query({ eventId, runId })}`, {
    secret,
    timeoutMs: EXPORT_TIMEOUT_MS,
  })
  if (!result.ok) {
    return result
  }

  const disposition = result.value.headers.get('Content-Disposition') ?? ''
  const match = /filename="([^"]+)"/.exec(disposition)

  return {
    ok: true,
    value: {
      blob: await result.value.blob(),
      fileName: match?.[1] ?? `${eventId}-${kind}`,
    },
  }
}

/**
 * Hands a downloaded export to the browser.
 *
 * The object URL is revoked immediately afterwards: it is a live handle to
 * every participant's details, and leaving one alive would let anything that
 * later runs in this tab read the file back.
 */
export function saveExport(download: DownloadedExport): void {
  const url = URL.createObjectURL(download.blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = download.fileName
    anchor.rel = 'noopener'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    // A tick, so the click has started the download before the handle goes.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

/** What a failure means to the operator reading the screen. */
export function describeFailure(failure: ReportingFailure): string {
  switch (failure) {
    case 'not_configured':
      return 'This build has no central server configured, so reporting is unavailable.'
    case 'reporting_disabled':
      return 'The central server has no reporting secret configured. Reporting is switched off there.'
    case 'unauthorized':
      return 'That reporting secret was rejected.'
    case 'no_run':
      return 'This event has never been reconciled. Run reconciliation to produce a report.'
    case 'not_found':
      return 'That record is not part of this event.'
    case 'server_error':
      return 'The central server failed to answer. Try again shortly.'
    case 'unreachable':
      return 'The central server could not be reached. Check the connection.'
    case 'timeout':
      return 'The central server took too long to answer.'
    case 'rejected':
      return 'The central server refused the request.'
  }
}
