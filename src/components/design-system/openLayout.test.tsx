import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AppShellV2 } from './AppShellV2'
import { DataTable, type DataColumn } from './DataTable'
import { EmptyState } from './EmptyState'
import { StatCard } from './StatCard'

/*
 * Open layouts are the default; a border is a claim.
 *
 * The first foundation drew a bordered, filled surface around almost
 * everything: every statistic was a tile, every table sat in a card, every
 * empty region was fenced in a dashed box. Four tiles above a boxed table
 * inside a section is boxes in boxes, and at that density a border has stopped
 * meaning "these things belong together" and become texture.
 *
 * These tests pin the defaults rather than the styling. A border coming back by
 * default is not a visual regression anyone would file: it looks tidy in
 * isolation and only reads as clutter once four of them are on a page, which is
 * exactly the kind of drift that needs a test rather than a reviewer.
 */

interface Row {
  readonly id: string
  readonly name: string
}

const COLUMNS: readonly DataColumn<Row>[] = [
  { key: 'name', header: 'Name', cell: (row) => row.name },
]

const ROWS: readonly Row[] = [{ id: '1', name: 'Ada Lovelace' }]

/** The outermost element a component renders, which is where its frame is. */
function root(container: HTMLElement): HTMLElement {
  return container.firstElementChild as HTMLElement
}

// Several tests here render more than once. Without this they query each
// other's leftovers and fail for a reason that has nothing to do with the code.
afterEach(cleanup)

describe('StatCard', () => {
  it('is a rule and a figure, not a tile, by default', () => {
    const { container } = render(<StatCard label="Registrations" value="1,284" />)
    const className = root(container).className

    // A rule on one edge, not a box: `border-t`, never a bare `border`.
    expect(className).not.toMatch(/(^|\s)border(\s|$)/)
    expect(className).not.toMatch(/bg-surface/)
    expect(className).not.toContain('rounded-card')
    expect(className).toContain('border-t')
  })

  it('becomes a tile only when asked', () => {
    const { container } = render(
      <StatCard variant="card" label="This device" value="403" />,
    )
    const className = root(container).className

    expect(className).toContain('rounded-card')
    expect(className).toContain('bg-surface')
  })

  it('renders the same figure either way', () => {
    // The variant is a frame decision. It must not change what is said.
    render(<StatCard label="Responses" value="1,109" unit="of 1,284" />)

    expect(screen.getByText('1,109')).toBeTruthy()
    expect(screen.getByText('of 1,284')).toBeTruthy()
  })
})

describe('DataTable', () => {
  it('draws rules rather than a box by default', () => {
    const { container } = render(
      <DataTable columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />,
    )
    const className = root(container).className

    expect(className).not.toContain('rounded-card')
    expect(className).toContain('border-t')
  })

  it('takes a frame for a table that sits beside other panels', () => {
    const { container } = render(
      <DataTable frame columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />,
    )

    expect(root(container).className).toContain('rounded-card')
  })

  it('still scrolls sideways rather than wrapping a code across two lines', () => {
    /*
     * The frame used to carry `overflow-hidden` for its corners, and the
     * horizontal scroll lives on the table's own container. Removing the frame
     * must not have taken the scrolling with it: a public code broken across
     * two lines is a code an operator reads aloud wrong.
     */
    const { container } = render(
      <DataTable columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />,
    )
    const scroller = container.querySelector('[data-slot="table-container"]')

    expect(scroller).not.toBeNull()
    expect((scroller as HTMLElement).className).toContain('overflow-x-auto')
  })

  it('contains a wide table instead of pushing the page sideways', () => {
    /*
     * A regression this pass introduced and this test now pins.
     *
     * Dropping the frame dropped its `overflow-hidden`, and that was doing more
     * than clipping corners: a flex item's `min-width` is `auto`, so a table
     * wider than a phone widened the document itself. At 430px the foundation
     * scrolled sideways by 29px, which on a real device is a page that slides
     * under the thumb while an operator is reading it.
     *
     * jsdom lays nothing out, so this asserts the property that prevents it
     * rather than the symptom.
     */
    for (const frame of [false, true]) {
      const { container } = render(
        <DataTable
          frame={frame}
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(row) => row.id}
        />,
      )

      expect(root(container).className, `frame=${String(frame)}`).toContain(
        'overflow-hidden',
      )
    }
  })
})

describe('the shell header', () => {
  const EVENT = 'Flying Flea Test Ride - Richardson & Cruddas'
  const DAY = '2026-08-23'

  function renderShell(context?: string) {
    return render(
      <AppShellV2
        eventName={EVENT}
        eventDay={DAY}
        {...(context === undefined ? {} : { context })}
        nav={[{ href: '#/a', label: 'Point A', active: true }]}
      >
        <p>screen</p>
      </AppShellV2>,
    )
  }

  it('is one row that sheds detail rather than a row that wraps', () => {
    /*
     * The whole mobile compaction, in one property. While the row could wrap,
     * a phone got three stacked bands of chrome before a word of the screen:
     * roughly a seventh of the first viewport spent restating the event.
     * Measured at 430px: 135px of header became 61px.
     *
     * jsdom lays nothing out, so this pins the cause rather than the height.
     */
    const { container } = renderShell()
    const row = container.querySelector('header > div') as HTMLElement

    expect(row.className).not.toContain('flex-wrap')
  })

  it('shows no context stump when there is no station to name', () => {
    /*
     * The first attempt fell back to the event day on narrow screens, which
     * truncated to "2026-0..." at 430px. That is not a smaller version of a
     * fact; it reads as a bug. The narrow line renders only when it has
     * something worth saying, and the event identity stays in the sheet.
     */
    const withoutContext = renderShell()
    expect(
      withoutContext.container.querySelectorAll('header .md\\:hidden'),
      // Only the navigation trigger, never a truncated line of event context.
    ).toHaveLength(1)
    withoutContext.unmount()

    const withContext = renderShell('Point A · Registration')
    const narrow = withContext.container.querySelector(
      'header span.md\\:hidden',
    ) as HTMLElement

    expect(narrow).not.toBeNull()
    expect(narrow.textContent).toBe('Point A · Registration')
  })

  it('carries the operational indicator on every surface', () => {
    // A product built around losing the network says whether it is ready to.
    const { container } = renderShell()

    expect(within(container).getByText('Online')).toBeTruthy()
  })
})

describe('EmptyState', () => {
  it('does not fence itself off by default', () => {
    const { container } = render(<EmptyState title="No participants yet" />)

    expect(root(container).className).not.toMatch(/border-dashed/)
  })

  it('takes an edge where the empty region needs one', () => {
    const { container } = render(<EmptyState bordered title="Drop a backup here" />)

    expect(root(container).className).toContain('border-dashed')
  })

  it('still says why it is empty and what to do', () => {
    // The frame changed. The thing that makes an empty state useful did not.
    render(
      <EmptyState
        title="No participants in this run"
        description="Reconciliation has not been run since the last sync."
      />,
    )

    expect(screen.getByText('No participants in this run')).toBeTruthy()
    expect(
      screen.getByText('Reconciliation has not been run since the last sync.'),
    ).toBeTruthy()
  })
})
