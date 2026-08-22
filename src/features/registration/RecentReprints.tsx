import { ChevronDownIcon, HistoryIcon, PrinterIcon } from 'lucide-react'
import { useState } from 'react'
import { AppButton } from '../../components/design-system'
import { cn } from '../../lib/ui/cn'
import type { RegistrationRecord } from '../../types'

/*
 * Reprint recovery, kept out of the way until it is wanted.
 *
 * ## What this is for, and what it must never become
 *
 * Exactly one job: "that sticker from three riders ago never came out, let me
 * print it again", and the same thing after a page refresh. It is not a
 * participant list, not a dashboard and not a search.
 *
 * It shows public codes and times, never names, and that is a privacy decision
 * rather than a layout one: a screen on a desk facing a queue should not carry
 * the last eight people's names, and nothing about reprinting a label needs
 * one. The component is given whole `RegistrationRecord`s, so the guarantee is
 * that this file reads three fields off them and no others.
 *
 * ## Why it collapses
 *
 * V1 rendered the list open, permanently, below whichever state the screen was
 * in. On a full desk that is eight rows of codes competing with the rider
 * standing in front of the operator, and it grew the page for every rider
 * registered. Collapsed, it is one quiet row at the bottom of the terminal that
 * says how many are available and gets out of the way.
 *
 * A disclosure rather than a sheet, on purpose: recovery is a one-tap job, and
 * an overlay would put a dialog between the operator and a task that takes two
 * seconds. Nothing here is modal, and opening it does not disturb the state
 * above it.
 */

interface RecentReprintsProps {
  readonly records: readonly RegistrationRecord[]
  /** The record currently on screen, which cannot be reprinted into itself. */
  readonly activeRecordId: string | null
  readonly onReprint: (record: RegistrationRecord) => void
}

export function RecentReprints({
  records,
  activeRecordId,
  onReprint,
}: RecentReprintsProps) {
  const [open, setOpen] = useState(false)

  if (records.length === 0) {
    return null
  }

  return (
    <section aria-labelledby="recent-heading" className="border-t border-line">
      <h2 id="recent-heading" className="sr-only">
        Recent registrations on this device
      </h2>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex min-h-touch w-full items-center gap-3 rounded-control px-1 py-2 text-left',
          'font-ui text-small text-muted transition-colors hover:text-ink',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive',
        )}
      >
        <HistoryIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          Reprint an earlier sticker
          <span className="text-faint">
            {' · '}
            {records.length} on this device
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <ul className="flex flex-col pb-2">
          {records.map((record) => {
            const active = record.recordId === activeRecordId

            return (
              <li
                key={record.recordId}
                className="flex items-center gap-3 border-t border-line py-2"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-small text-ink tabular-nums">
                  {record.publicCode}
                </span>
                <span className="shrink-0 font-mono text-caption text-faint tabular-nums">
                  {new Date(record.createdAt).toLocaleTimeString()}
                </span>
                <AppButton
                  size="sm"
                  variant={active ? 'ghost' : 'secondary'}
                  disabled={active}
                  onClick={() => onReprint(record)}
                >
                  {active ? (
                    'Showing'
                  ) : (
                    <>
                      <PrinterIcon />
                      Reprint
                    </>
                  )}
                </AppButton>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
