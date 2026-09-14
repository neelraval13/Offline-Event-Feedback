import { getLocalCounts, type LocalCounts } from '../../lib/storage'
import { db } from '../../lib/storage'
import { EVENT_CONFIG } from '../../config/event'
import { useEffect, useState } from 'react'

/**
 * How much data is on this device, and how much of it exists nowhere else.
 *
 * Counts only. A support screen never needs a participant's name, and putting
 * one on a desk-facing display would be a privacy leak that buys nothing.
 *
 * The pending figures are the ones that matter operationally: a pending record
 * lives on exactly one machine, and that number is the size of the loss if it
 * fails.
 *
 * ## The headline figures are this event's
 *
 * A browser can hold more than one event's records. Counting another event's
 * pending rows here would report September work that does not exist and send
 * somebody looking for a September fault; hiding them would let a device be
 * wiped while it still held the only copy of somebody's registration. So they
 * are excluded from the figures and stated on their own line underneath.
 */
export function LocalDataPanel({ refreshToken = 0 }: { readonly refreshToken?: number }) {
  const [counts, setCounts] = useState<LocalCounts | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        const loaded = await getLocalCounts(db, EVENT_CONFIG.eventId)
        if (active) {
          setCounts(loaded)
          setError(null)
        }
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error ? caught.message : 'Local data is unreadable.',
          )
        }
      }
    })()

    return () => {
      active = false
    }
  }, [refreshToken])

  const format = (value: number) => value.toLocaleString()

  return (
    <section aria-labelledby="local-data-heading">
      <h2 id="local-data-heading" className="pending__title">
        Local data
      </h2>

      {error !== null && (
        <p className="notice notice--error" role="alert">
          Local data could not be read: {error}
        </p>
      )}

      <dl className="station-badge">
        <div>
          <dt>Registrations</dt>
          <dd data-testid="count-registrations">
            {counts === null ? 'Counting…' : format(counts.registrations.total)}
          </dd>
        </div>
        <div>
          <dt>Feedback</dt>
          <dd data-testid="count-feedback">
            {counts === null ? 'Counting…' : format(counts.feedback.total)}
          </dd>
        </div>
        <div>
          <dt>Pending registrations</dt>
          <dd data-testid="count-registrations-pending">
            {counts === null ? 'Counting…' : format(counts.registrations.pending)}
          </dd>
        </div>
        <div>
          <dt>Pending feedback</dt>
          <dd data-testid="count-feedback-pending">
            {counts === null ? 'Counting…' : format(counts.feedback.pending)}
          </dd>
        </div>
        <div>
          <dt>Synced</dt>
          <dd data-testid="count-synced">
            {counts === null
              ? 'Counting…'
              : format(counts.registrations.synced + counts.feedback.synced)}
          </dd>
        </div>
        <div>
          <dt>Errors</dt>
          <dd data-testid="count-error">
            {counts === null
              ? 'Counting…'
              : format(counts.registrations.error + counts.feedback.error)}
          </dd>
        </div>
      </dl>

      <p className="screen__note">
        Pending records exist only on this device. Keep an encrypted backup.
      </p>

      {counts !== null &&
        counts.otherEvents.registrations + counts.otherEvents.feedback > 0 && (
          /*
           * Stated as a fact, and stated at all.
           *
           * These rows cannot be delivered by this build: the server
           * authenticates a batch against one event and refuses any record
           * belonging to another. This device will never attempt them, which is
           * what keeps them intact, and it also means nothing else on this
           * screen would ever mention them. Somebody clearing site data has to
           * know they are here first.
           */
          <div
            className={
              counts.otherEvents.undelivered > 0
                ? 'notice notice--error'
                : 'notice'
            }
            role={counts.otherEvents.undelivered > 0 ? 'alert' : undefined}
            data-testid="other-event-records"
          >
            <p>
              Records from another event remain on this device:{' '}
              {format(counts.otherEvents.registrations)} registration(s) and{' '}
              {format(counts.otherEvents.feedback)} feedback record(s), from{' '}
              {counts.otherEvents.eventIds.join(', ')}. They are not counted
              above and this build never syncs them.
            </p>
            {counts.otherEvents.undelivered > 0 && (
              <p data-testid="other-event-undelivered">
                <strong>
                  {format(counts.otherEvents.undelivered)} of them have not
                  reached the central server.
                </strong>{' '}
                Go back to that event's own build or recovery process before you
                clear local storage on this device. Enrolling here cannot send
                them, and clearing site data would destroy the only copy.
              </p>
            )}
          </div>
        )}
    </section>
  )
}
