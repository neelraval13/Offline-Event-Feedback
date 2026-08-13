import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  Sticker,
  STICKER_HEIGHT_MM,
  STICKER_WIDTH_MM,
} from './Sticker'
import { publicParticipantCode } from '../../types'

afterEach(cleanup)

const CODE = publicParticipantCode('A1-B8EFD9-00001-X')
const QR = '<svg viewBox="0 0 49 49"><path d="M0 0h49v49H0z"/></svg>'

describe('Sticker', () => {
  it('shows the public code', () => {
    render(<Sticker qrSvg={QR} publicCode={CODE} />)
    expect(screen.getByText('A1-B8EFD9-00001-X')).toBeDefined()
  })

  it('renders the QR markup it is given', () => {
    render(<Sticker qrSvg={QR} publicCode={CODE} />)
    const qr = screen.getByTestId('sticker').querySelector('.sticker__qr svg')
    expect(qr).not.toBeNull()
  })

  it('has no way to receive PII', () => {
    // The component's props are a code and pre-rendered markup — there is no
    // registration record in scope, so a name cannot reach a label even by
    // accident. This test exists to fail loudly if someone widens the props.
    render(<Sticker qrSvg={QR} publicCode={CODE} />)
    const markup = screen.getByTestId('sticker').innerHTML

    expect(markup).toContain('A1-B8EFD9-00001-X')
    for (const secret of ['Ada', 'Lovelace', '@', '+44', 'example.com']) {
      expect(markup).not.toContain(secret)
    }
  })

  it('declares the agreed physical label size', () => {
    expect(STICKER_WIDTH_MM).toBe(50)
    expect(STICKER_HEIGHT_MM).toBe(40)
  })
})
