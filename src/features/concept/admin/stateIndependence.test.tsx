import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminConcept } from './AdminConcept'
import { readinessStatus } from './AdminSections'
import { STATUS } from '@/components/design-system/status'

/*
 * Offline readiness and local-storage health are two facts, from two systems.
 *
 * Readiness is the service worker's answer about the precached shell. Storage
 * health is IndexedDB's answer about whether a write lands. Either can be fine
 * while the other is not:
 *
 *   ready shell, broken store   the device is prepared to run offline and has
 *                               nowhere to put what it collects. It must stop.
 *   preparing shell, fine store writes land; the device is not field-safe yet.
 *
 * The first draft of this concept collapsed them, so a broken database made the
 * console report "Offline readiness: Unknown". That was two mistakes at once:
 * it stated something untrue about the shell, and it raised the wrong alarm,
 * because "unknown" is a shrug where "this device cannot write" is a stop.
 *
 * These tests exist so a later edit cannot reintroduce the coupling. The most
 * important one is structural: `readinessStatus` is given a readiness state and
 * nothing else, so it *cannot* consult storage.
 */

afterEach(cleanup)

/** Drives the review rail, which is how the concept exposes its fixtures. */
async function setAxis(
  user: ReturnType<typeof userEvent.setup>,
  axis: string,
  label: string,
) {
  const group = screen.getByRole('group', { name: `${axis} states` })
  await user.click(within(group).getByRole('button', { name: label }))
}

function renderConcept() {
  render(<AdminConcept />)
  return userEvent.setup()
}

/** An overview cell, by its label. Both pills live in one. */
function overviewCell(label: string): HTMLElement {
  const heading = screen.getAllByText(label)[0] as HTMLElement
  return heading.parentElement as HTMLElement
}

const readinessPill = () => overviewCell('Offline readiness')
const storagePill = () => overviewCell('Local storage')

describe('readinessStatus', () => {
  it('is given readiness and nothing else', () => {
    /*
     * The structural guarantee, and the reason the other tests can be short.
     * A one-argument function over `HealthState` has no way to reach storage
     * health, so the coupling cannot come back by accident: it would have to
     * come back by changing this signature, which fails here.
     */
    expect(readinessStatus).toHaveLength(1)
  })

  it('reports what the shell says, for every readiness value', () => {
    expect(readinessStatus('healthy')).toBe('offline-ready')
    expect(readinessStatus('update-available')).toBe('offline-ready')
    expect(readinessStatus('preparing')).toBe('offline-preparing')
    expect(readinessStatus('offline-failed')).toBe('offline-failed')
  })

  it('says unknown only when readiness itself is unknowable', () => {
    /*
     * A browser without service workers, or a dev build with none registered.
     * Not "the database would not open", which is a different system entirely
     * and a much louder problem.
     */
    expect(readinessStatus('readiness-unknown')).toBe('unknown')

    for (const known of [
      'healthy',
      'preparing',
      'offline-failed',
      'update-available',
    ] as const) {
      expect(readinessStatus(known)).not.toBe('unknown')
    }
  })
})

describe('a ready shell with a broken store', () => {
  it('keeps saying the shell is ready for offline use', async () => {
    const user = renderConcept()
    await setAxis(user, 'Storage', 'Local DB failed')

    // Readiness is unchanged: the service worker's answer did not change.
    expect(
      within(readinessPill()).getAllByText('Ready for offline use').length,
    ).toBeGreaterThan(0)
    expect(within(readinessPill()).queryByText('Unknown')).toBeNull()
  })

  it('raises the storage failure separately, and in red', async () => {
    const user = renderConcept()
    await setAxis(user, 'Storage', 'Local DB failed')

    const alert = screen.getByText('Local storage problem').closest(
      '[data-slot="alert"]',
    ) as HTMLElement

    expect(alert.className).toContain('bg-danger-soft')
    expect(STATUS['sync-error'].tone).toBe('danger')
  })

  it('says the device must not take registrations or feedback', async () => {
    const user = renderConcept()
    await setAxis(user, 'Storage', 'Local DB failed')

    const alert = screen.getByText('Local storage problem').closest(
      '[data-slot="alert"]',
    ) as HTMLElement

    expect(alert.textContent).toMatch(/must not take registrations or feedback/i)
    // And why: writes cannot be persisted, so entries would be lost.
    expect(alert.textContent).toMatch(/cannot be persisted/i)
    // And that this is a different fact from the readiness above it.
    expect(alert.textContent).toMatch(/separate from offline readiness/i)
  })

  it('does not tell the operator to carry on', async () => {
    /*
     * Readiness stays true, but the conclusion changes. A prepared shell with
     * no writable store is prepared to do nothing useful, and the healthy
     * sentence would read as permission.
     */
    const user = renderConcept()
    await setAxis(user, 'Storage', 'Local DB failed')

    expect(
      screen.queryByText(
        /can keep collecting registrations and feedback with no network/i,
      ),
    ).toBeNull()
    expect(screen.getByText(/It still must not be used/i)).toBeTruthy()
  })
})

describe('a broken shell with a healthy store', () => {
  it('reports the shell problem without claiming a storage one', async () => {
    const user = renderConcept()
    await setAxis(user, 'Health', 'Offline failed')

    expect(within(readinessPill()).getAllByText('Not ready').length).toBeGreaterThan(0)
    // The store is fine, and the console says so rather than going quiet.
    expect(within(storagePill()).getAllByText('Healthy').length).toBeGreaterThan(0)
    expect(screen.queryByText('Local storage problem')).toBeNull()
  })

  it('leaves storage healthy while the shell is still preparing', async () => {
    const user = renderConcept()
    await setAxis(user, 'Health', 'Preparing')

    expect(within(readinessPill()).getAllByText('Preparing').length).toBeGreaterThan(0)
    expect(screen.queryByText('Local storage problem')).toBeNull()
  })
})

describe('the two facts are reported as two facts', () => {
  it('gives local storage its own row in the overview', async () => {
    renderConcept()

    expect(screen.getByText('Local storage')).toBeTruthy()
    expect(screen.getAllByText('Offline readiness').length).toBeGreaterThan(0)
  })

  it('can be unknown-readiness and healthy-storage at the same time', async () => {
    /*
     * The combination that proves they are not one value: the shell cannot say
     * whether it is ready, and the database is demonstrably fine.
     */
    const user = renderConcept()
    await setAxis(user, 'Health', 'Readiness unknown')

    expect(within(readinessPill()).getAllByText('Unknown').length).toBeGreaterThan(0)
    expect(within(storagePill()).getAllByText('Healthy').length).toBeGreaterThan(0)
    expect(screen.queryByText('Local storage problem')).toBeNull()
  })

  it('can be ready-readiness and failed-storage at the same time', async () => {
    const user = renderConcept()
    await setAxis(user, 'Storage', 'Local DB failed')

    expect(
      within(readinessPill()).getAllByText('Ready for offline use').length,
    ).toBeGreaterThan(0)
    expect(within(storagePill()).getAllByText('Cannot write').length).toBeGreaterThan(0)
  })
})
