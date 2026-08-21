import type { ComponentProps } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * The text input primitive.
 *
 * `min-h-touch` and a 15px minimum are both deliberate: anything under 16px
 * makes mobile Safari zoom the page the moment the field takes focus, which on
 * a tablet at a registration desk means the operator loses their place several
 * hundred times a shift. `--text-base` is 15px, so the `text-base` utility here
 * is paired with an explicit `md:text-small` nowhere: the field stays readable
 * at every width instead.
 */
export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex min-h-touch w-full rounded-control border border-line bg-field px-3.5 py-2',
        'font-ui text-base text-ink',
        'transition-[border-color,box-shadow] duration-150',
        'placeholder:text-faint',
        'hover:border-line-strong',
        'focus-visible:border-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // Driven by the field wrapper, so an invalid control looks invalid
        // whether the error came from the browser or from our own validation.
        'aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/25',
        'file:border-0 file:bg-transparent file:text-small file:font-medium',
        className,
      )}
      {...props}
    />
  )
}
