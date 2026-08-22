import { useId } from 'react'
import { AppButton } from '@/components/design-system'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/ui/cn'

/*
 * Typing the code printed under the QR.
 *
 * ## The field is sized for the thing being copied
 *
 * A public code is seventeen characters of mixed letters and digits, read off a
 * 50mm label held in one hand and typed with the other. So it is set large, in
 * the monospace face, tracked apart, and upper-cased by the browser: the
 * operator can see at a glance that what is on the screen matches what is on
 * the sticker, which is the only check available to them.
 *
 * The placeholder is the real shape, `A1-B8EFD9-00001-X`, so the separator
 * pattern is visible before a single character is typed.
 *
 * ## Nothing is normalised or validated here
 *
 * The identity layer already forgives case, separator style and under-padded
 * sequences, and re-implementing any of that in a React component is how two
 * different notions of "the same code" start to exist. This component collects
 * a string and hands it over. That is V1's rule and it is exactly right.
 *
 * ## A rejected code is still on screen
 *
 * The value is the caller's, so an invalid code stays in the field with the
 * message beneath it. Clearing the box on rejection would make the operator
 * re-read the sticker to find out what they got wrong.
 */

interface ManualCodePanelProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly error: string | null
  readonly onSubmit: () => void
  readonly onBack: () => void
  readonly onContact: () => void
}

export function ManualCodePanel({
  value,
  onChange,
  error,
  onSubmit,
  onBack,
  onContact,
}: ManualCodePanelProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  return (
    <section aria-labelledby="manual-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2
          id="manual-heading"
          className="font-display text-title tracking-wide text-ink"
        >
          Enter code
        </h2>
        <p className="max-w-measure font-body text-lead text-muted">
          The code printed under the QR on the rider's sticker.
        </p>
      </div>

      <form
        /* A concept. Nothing is submitted, validated or stored. */
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
        noValidate
        className="flex max-w-lg flex-col gap-2"
      >
        <Label htmlFor={id}>Participant code</Label>
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="A1-B8EFD9-00001-X"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? hintId : `${hintId} ${errorId}`}
          className={cn(
            'w-full rounded-control border border-line bg-field px-4 py-3',
            'font-mono text-lead uppercase tracking-[0.12em] text-ink',
            'transition-[border-color,box-shadow] duration-150',
            'placeholder:tracking-[0.12em] placeholder:text-faint',
            'hover:border-line-strong',
            'focus-visible:border-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive/40',
            'aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/25',
          )}
        />

        <p id={hintId} className="font-body text-small text-faint">
          Letters and digits, with or without the dashes.
        </p>

        {error !== null && (
          <p
            id={errorId}
            role="alert"
            className="font-ui text-small font-medium text-danger"
          >
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2.5 pt-2">
          <AppButton type="submit">Continue</AppButton>
          <AppButton type="button" variant="secondary" onClick={onBack}>
            Back to scanner
          </AppButton>
          {/*
            The third path stays reachable from here. An operator who has just
            discovered the rider has no sticker should not have to go backwards
            through the scanner to say so.
          */}
          <AppButton type="button" variant="ghost" onClick={onContact}>
            No code either
          </AppButton>
        </div>
      </form>
    </section>
  )
}
