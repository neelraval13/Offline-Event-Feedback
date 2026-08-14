import type { ButtonHTMLAttributes } from 'react'

/*
 * The campaign's pill button.
 *
 * A real `<button>` with real semantics: the supplied design changes how it
 * looks, not what it is. `type` is required rather than defaulted, because a
 * button inside a form that forgets it submits.
 */

interface BrandButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly type: 'button' | 'submit'
  readonly variant?: 'primary' | 'quiet'
  readonly block?: boolean
}

export function BrandButton({
  variant = 'primary',
  block = false,
  className,
  ...rest
}: BrandButtonProps) {
  const classes = [
    'ff-button',
    variant === 'quiet' ? 'ff-button--quiet' : '',
    block ? 'ff-button--block' : '',
    className ?? '',
  ]
    .filter((value) => value.length > 0)
    .join(' ')

  return <button className={classes} {...rest} />
}
