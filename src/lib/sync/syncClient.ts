import type {
  EnrollmentResponse,
  SyncBatch,
  SyncBatchResponse,
} from '../../../shared/sync/protocol'
import { SYNC_API_BASE_URL, SYNC_REQUEST_TIMEOUT_MS } from './syncConfig'

/*
 * The HTTP boundary.
 *
 * Every failure is classified into "the server said something" versus "we never
 * heard back", because the two mean opposite things for local records. A
 * transient failure must leave records pending and retryable; only a definite
 * server answer may mark one permanently in error.
 *
 * A lost response is indistinguishable from a request that never arrived, and
 * that is exactly why records stay pending: the retry is safe because ingest is
 * idempotent.
 */

export type TransportFailure =
  /** No answer: offline, DNS, refused connection, dropped mid-flight. */
  | 'unreachable'
  /** The request was abandoned after the timeout. */
  | 'timeout'
  /** The server is there but broken. Retryable. */
  | 'server_error'
  /** Credentials rejected. Not retryable without re-enrolling. */
  | 'unauthorized'
  /** The server refused the request itself, not its records. */
  | 'rejected'
  /** No API base URL is configured in this build. */
  | 'not_configured'

export type SyncTransportResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: TransportFailure }

async function postJson<T>(
  path: string,
  body: unknown,
  options: { token?: string; signal?: AbortSignal } = {},
): Promise<SyncTransportResult<T>> {
  if (SYNC_API_BASE_URL === null) {
    return { ok: false, failure: 'not_configured' }
  }

  /*
   * A broken connection can otherwise hang until the browser gives up, which on
   * some platforms is minutes. Records stay pending on timeout, so abandoning
   * early costs nothing.
   */
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SYNC_REQUEST_TIMEOUT_MS)

  options.signal?.addEventListener('abort', () => controller.abort(), {
    once: true,
  })

  let response: Response
  try {
    response = await fetch(`${SYNC_API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token === undefined
          ? {}
          : { Authorization: `Bearer ${options.token}` }),
      },
      body: JSON.stringify(body),
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

  if (response.status === 401 || response.status === 403) {
    return { ok: false, failure: 'unauthorized' }
  }
  if (response.status >= 500) {
    return { ok: false, failure: 'server_error' }
  }
  if (!response.ok) {
    return { ok: false, failure: 'rejected' }
  }

  try {
    return { ok: true, value: (await response.json()) as T }
  } catch {
    // Committed on the server, perhaps, but unreadable here. Treated as
    // unreachable so the records stay pending and the retry re-establishes
    // the truth.
    return { ok: false, failure: 'unreachable' }
  }
}

export async function enrollDevice(request: {
  eventId: string
  deviceId: string
  enrollmentSecret: string
}): Promise<SyncTransportResult<EnrollmentResponse>> {
  return postJson<EnrollmentResponse>('/v1/sync/enroll', request)
}

export async function postBatch(
  batch: SyncBatch,
  token: string,
  signal?: AbortSignal,
): Promise<SyncTransportResult<SyncBatchResponse>> {
  return postJson<SyncBatchResponse>('/v1/sync/batch', batch, {
    token,
    ...(signal === undefined ? {} : { signal }),
  })
}
