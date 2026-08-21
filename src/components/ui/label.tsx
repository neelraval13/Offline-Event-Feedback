import * as LabelPrimitive from '@radix-ui/react-label'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * The label primitive.
 *
 * Uppercase and tracked, which is the campaign's own treatment for field
 * labels and happens to be the right call operationally too: a label set in
 * small caps is distinguishable from its value at a glance, which is what
 * makes a dense form scannable rather than readable.
 */
export function Label({
  className,
  ...props
}: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'font-ui text-label font-semibold uppercase tracking-[0.08em] text-muted',
        'select-none',
        'group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
