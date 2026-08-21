import type { ComponentProps } from 'react'
import { cn } from '@/lib/ui/cn'

/*
 * The table primitive.
 *
 * The wrapper scrolls horizontally rather than letting cells wrap. A public
 * code broken across two lines is a code an operator will misread aloud, and
 * these tables carry codes, emails and long identifiers on every row.
 *
 * Row height is generous by table standards for the same reason every other
 * target is: rows are pressed on a tablet to open a record.
 */
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn('w-full caption-bottom font-ui text-base', className)}
        {...props}
      />
    </div>
  )
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b [&_tr]:border-line', className)}
      {...props}
    />
  )
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-line transition-colors',
        'hover:bg-raised/60 data-[state=selected]:bg-interactive-soft',
        className,
      )}
      {...props}
    />
  )
}

export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-11 whitespace-nowrap px-3 text-left align-middle',
        'font-ui text-label font-semibold uppercase tracking-[0.08em] text-muted',
        // Numeric columns opt in with `data-numeric`, so alignment is a
        // property of the column rather than something each cell repeats.
        '[&[data-numeric=true]]:text-right',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'whitespace-nowrap px-3 py-2.5 align-middle text-base text-ink',
        // Figures line up in a column and do not shift width as they change.
        '[&[data-numeric=true]]:text-right [&[data-numeric=true]]:font-mono [&[data-numeric=true]]:tabular-nums',
        className,
      )}
      {...props}
    />
  )
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-3 text-small text-muted', className)}
      {...props}
    />
  )
}
