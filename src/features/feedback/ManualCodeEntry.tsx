import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { AppButton } from '../../components/design-system'
import { Label } from '../../components/ui/label'
import { cn } from '../../lib/ui/cn'

interface ManualCodeEntryProps {
  readonly error: string | null
  readonly onSubmit: (typed: string) => void
  readonly onCancel: () => void
  readonly canCancel: boolean
  /** The third path, reachable from here without going backwards. */
  readonly onContact: () => void
}

/**
 * Typing the code printed under the QR.
 *
 * ## Nothing is normalised or validated here
 *
 * The identity layer already forgives case, separator style and under-padded
 * sequences, and re-implementing any of that in a React component is how two
 * different notions of "the same code" start to exist. This collects a string
 * and hands it over, exactly as V1 did.
 *
 * ## What V2 changed
 *
 * The field is sized for the thing being copied. A public code is seventeen
 * characters of mixed letters and digits, read off a 50mm label held in one
 * hand and typed with the other, so it is set large, in the monospace face,
 * tracked apart and upper-cased by the browser: an operator can see at a glance
 * that what is on screen matches what is on the sticker, which is the only
 * check available to them. The placeholder is the real shape, so the separator
 * pattern is visible before a character is typed.
 *
 * A rejected code stays in the field. The value is local state and nothing
 * clears it, so the message appears beneath what was typed rather than beside
 * an empty box the operator would have to re-read the sticker to refill.
 *
 * Name is focused on arrival, as before.
 */
export function ManualCodeEntry({
  error,
  onSubmit,
  onCancel,
  canCancel,
  onContact,
}: ManualCodeEntryProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(value)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-lg flex-col gap-2">
      <Label htmlFor={id}>Participant code</Label>
      <input
        id={id}
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
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
        The code printed under the QR on the rider's sticker.
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
        {canCancel && (
          <AppButton type="button" variant="secondary" onClick={onCancel}>
            Back to scanner
          </AppButton>
        )}
        {/*
          An operator who has just discovered the rider has no sticker should
          not have to go backwards through the scanner to say so.
        */}
        <AppButton type="button" variant="ghost" onClick={onContact}>
          No code either
        </AppButton>
      </div>
    </form>
  )
}
