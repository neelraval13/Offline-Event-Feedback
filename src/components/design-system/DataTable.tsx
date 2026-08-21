import type { ReactNode } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/ui/cn'
import { EmptyState } from './EmptyState'
import { LoadingState } from './LoadingState'

/*
 * The table pattern the data screens will use.
 *
 * Column-driven rather than markup-driven: a caller describes its columns once
 * and the component decides alignment, header treatment, numeric formatting,
 * row height and what to render when there is nothing. Before this, every
 * table in Reporting hand-wrote its own `<thead>`, and they had already drifted
 * apart on cell padding and on whether a "no rows" message appeared at all.
 *
 * The three states a table can be in are handled here, in one place, because a
 * table that renders an empty `<tbody>` while loading is indistinguishable
 * from one that found nothing:
 *
 *   loading  a skeleton shaped like the rows that are coming
 *   empty    an explanation and, where there is one, a next action
 *   rows     the data
 *
 * Deliberately not a virtualising or client-sorting table. Reporting pages the
 * data on the server with a keyset cursor and filters through the API, which
 * is what makes it work at ten thousand participants; a table component that
 * sorted the loaded page in the browser would silently sort one page and look
 * like it had sorted everything. `sortable` therefore only renders the
 * affordance and reports the intent upward.
 *
 * ## Rules, not a box
 *
 * The table draws its own horizontal rules, so the surrounding bordered card
 * was a second edge around a thing that already had one, and a 22px corner
 * radius on a dense grid of codes and counts is what made the foundation read
 * as a dashboard template rather than as a console. The default is now an open
 * table on the page: a rule above the header, a rule under each row, nothing
 * else. `frame` puts the card back for the case that needs it, which is a table
 * sitting beside other panels rather than owning its region of the page.
 */

export interface DataColumn<Row> {
  /** Stable identity for this column. Also the sort key reported upward. */
  readonly key: string
  readonly header: ReactNode
  /** Figures: right-aligned, tabular, monospaced. */
  readonly numeric?: boolean
  /** Renders the cell. Given the row, returns whatever should appear. */
  readonly cell: (row: Row) => ReactNode
  /** Hidden below `md`, for columns that are context rather than content. */
  readonly hideOnNarrow?: boolean
  readonly width?: string
}

export interface DataTableProps<Row> {
  readonly columns: readonly DataColumn<Row>[]
  readonly rows: readonly Row[]
  /** Stable key per row. A record ID, never an array index. */
  readonly rowKey: (row: Row) => string
  readonly loading?: boolean
  /** Shown instead of the table when there are no rows and nothing is loading. */
  readonly empty?: ReactNode
  /** Makes a row activatable. Used to open a record. */
  readonly onRowClick?: (row: Row) => void
  /** Marks the active row, so an open detail panel has a visible source. */
  readonly isRowSelected?: (row: Row) => boolean
  /** The column currently sorted, and which way. */
  readonly sort?: { readonly key: string; readonly direction: 'asc' | 'desc' }
  /** Called with a column key when a sortable header is activated. */
  readonly onSortChange?: (key: string) => void
  /** Wraps the table in a bordered surface. For a table beside other panels. */
  readonly frame?: boolean
  readonly className?: string
  /** Describes the table to a screen reader. */
  readonly label?: string
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  onRowClick,
  isRowSelected,
  sort,
  onSortChange,
  frame = false,
  className,
  label,
}: DataTableProps<Row>) {
  if (loading && rows.length === 0) {
    return <LoadingState label="Loading rows" rows={5} className={cn(className)} />
  }

  if (rows.length === 0) {
    return (
      <div className={cn(className)}>
        {empty ?? <EmptyState title="Nothing to show" />}
      </div>
    )
  }

  return (
    <div
      /*
       * `overflow-hidden` is load-bearing in both variants, and only one of
       * them looks like it needs it.
       *
       * The frame used it to clip its own corners. The open variant has no
       * corners to clip and needs it for a different reason: a flex item's
       * `min-width` computes to `auto`, so a table wider than the phone pushes
       * the whole page sideways instead of scrolling inside its own container.
       * Any `overflow` other than `visible` resolves that min-width to zero.
       *
       * Nothing is actually hidden. `Table` puts the row region in its own
       * `overflow-x-auto` container, so a wide table still scrolls; it just
       * scrolls itself rather than the document. Removing this is how a phone
       * ends up with a horizontally scrolling page, which is pinned by a test.
       */
      className={cn(
        'overflow-hidden',
        frame ? 'rounded-card border border-line bg-surface' : 'border-t border-line',
        className,
      )}
    >
      <Table {...(label === undefined ? {} : { 'aria-label': label })}>
        <TableHeader className={cn(frame && 'bg-canvas/60')}>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => {
              const sorted = sort?.key === column.key ? sort.direction : undefined

              return (
                <TableHead
                  key={column.key}
                  data-numeric={column.numeric === true ? 'true' : undefined}
                  className={cn(column.hideOnNarrow === true && 'hidden md:table-cell')}
                  style={column.width === undefined ? undefined : { width: column.width }}
                  /*
                   * Announced to assistive technology, and the only reason the
                   * sort affordance is legible without seeing the arrow.
                   */
                  aria-sort={
                    sorted === undefined
                      ? undefined
                      : sorted === 'asc'
                        ? 'ascending'
                        : 'descending'
                  }
                >
                  {onSortChange === undefined ? (
                    column.header
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSortChange(column.key)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-chip',
                        'uppercase tracking-[0.08em] transition-colors hover:text-ink',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive',
                        sorted !== undefined && 'text-ink',
                      )}
                    >
                      {column.header}
                      <span aria-hidden="true" className="text-faint">
                        {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : '↕'}
                      </span>
                    </button>
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((row) => {
            const selected = isRowSelected?.(row) === true

            return (
              <TableRow
                key={rowKey(row)}
                data-state={selected ? 'selected' : undefined}
                className={cn(onRowClick !== undefined && 'cursor-pointer')}
                {...(onRowClick === undefined
                  ? {}
                  : {
                      onClick: () => onRowClick(row),
                      tabIndex: 0,
                      role: 'button',
                      /*
                       * A clickable row must be operable from a keyboard. This
                       * is the whole reason row activation lives here rather
                       * than being left to each screen to remember.
                       */
                      onKeyDown: (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onRowClick(row)
                        }
                      },
                    })}
              >
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    data-numeric={column.numeric === true ? 'true' : undefined}
                    className={cn(column.hideOnNarrow === true && 'hidden md:table-cell')}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
