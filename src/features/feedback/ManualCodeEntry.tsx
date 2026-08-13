import { useEffect, useRef, useState, type FormEvent } from 'react'

interface ManualCodeEntryProps {
  readonly error: string | null
  readonly onSubmit: (typed: string) => void
  readonly onCancel: () => void
  readonly canCancel: boolean
}

/**
 * The fallback when a sticker will not scan.
 *
 * Nothing is normalised or validated here. The identity layer already forgives
 * case, separator style and under-padded sequences, and re-implementing any of
 * that in a React component is how two different notions of "the same code"
 * start to exist.
 */
export function ManualCodeEntry({
  error,
  onSubmit,
  onCancel,
  canCancel,
}: ManualCodeEntryProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(value)
  }

  return (
    <form className="manual-entry" onSubmit={handleSubmit} noValidate>
      <label className="field__label" htmlFor="manual-code">
        Participant code
      </label>
      <input
        id="manual-code"
        ref={inputRef}
        className="field__input manual-entry__input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="A1-B8EFD9-00001-X"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : 'manual-code-error'}
      />
      <p className="screen__note">
        The code printed under the QR on the participant’s sticker.
      </p>

      {error !== null && (
        <p className="field__error" id="manual-code-error" role="alert">
          {error}
        </p>
      )}

      <div className="button-row">
        <button type="submit" className="button button--primary">
          Continue
        </button>
        {canCancel && (
          <button type="button" className="button" onClick={onCancel}>
            Back to scanner
          </button>
        )}
      </div>
    </form>
  )
}
