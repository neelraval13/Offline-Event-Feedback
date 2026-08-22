import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { App } from './App'

// Auto-cleanup is not registered because Vitest globals are off.
afterEach(cleanup)

function renderAt(hash: string) {
  window.location.hash = hash
  return render(<App />)
}

describe('App routing', () => {
  it('renders the registration surface at #/a', () => {
    /*
     * The V2 terminal names the job in hand rather than restating the campaign:
     * the photographic hero that carried "Test Ride Registration" was 300px at
     * the top of a form the operator returns to several hundred times a shift.
     */
    renderAt('#/a')
    expect(
      screen.getByRole('heading', { level: 1, name: /New rider/ }),
    ).toBeDefined()
  })

  it('renders the feedback surface at #/b', () => {
    renderAt('#/b')
    expect(
      screen.getByRole('heading', { level: 1, name: /Test Ride Feedback/ }),
    ).toBeDefined()
  })

  it('renders the admin surface at #/admin', () => {
    renderAt('#/admin')
    expect(
      screen.getByRole('heading', { level: 1, name: 'Device Admin' }),
    ).toBeDefined()
  })

  it('falls back to a not-found screen for unknown hashes', () => {
    renderAt('#/nope')
    expect(
      screen.getByRole('heading', { level: 1, name: 'Screen not found' }),
    ).toBeDefined()
  })

  it('follows hash changes without a reload', () => {
    renderAt('#/a')
    act(() => {
      window.location.hash = '#/b'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(
      screen.getByRole('heading', { level: 1, name: /Test Ride Feedback/ }),
    ).toBeDefined()
  })
})
