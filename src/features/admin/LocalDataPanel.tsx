import { getLocalCounts, type LocalCounts } from '../../lib/storage'
import { db } from '../../lib/storage'
import { useEffect, useState } from 'react'

/**
 * How much data is on this device, and how much of it exists nowhere else.
 *
 * Counts only. A support screen never needs a participant's name, and putting
 * one on a desk-facing display would be a privacy leak that buys nothing.
 *
 * The pending figures are the ones that matter operationally: until
 * synchronisation exists, every pending record lives on exactly one machine,
 * and that number is the size of the loss if it fails.
 */
export function LocalDataPanel({ refreshToken = 0 }: { readonly refreshToken?: number }) {
  const [counts, setCounts] = useState<LocalCounts | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        const loaded = await getLocalCounts(db)
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
    </section>
  )
}
