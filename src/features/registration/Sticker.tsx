import type { PublicParticipantCode } from '../../types'

/** Printed label dimensions, in millimetres. */
export const STICKER_WIDTH_MM = 50
export const STICKER_HEIGHT_MM = 40

interface StickerProps {
  /** Rendered QR markup. A sticker without one is not a sticker. */
  readonly qrSvg: string
  readonly publicCode: PublicParticipantCode
  /** Distinguishes the on-screen preview from the portalled print copy. */
  readonly testId?: string
}

/**
 * The printable sticker: a QR code and the public code beneath it.
 *
 * This component is the whole privacy boundary for the printed artefact. It
 * accepts a public code and pre-rendered QR markup — **not** a registration
 * record — so there is no name, phone or email in scope to leak onto a label
 * even by accident. A sticker is worn in public by someone who cannot see what
 * it says about them; it says nothing about them.
 *
 * Both props are required, so a sticker cannot be rendered in a half-built
 * state and then printed blank. Callers render this only once the QR exists.
 *
 * Sized in millimetres rather than pixels because the output is physical. The
 * same element is what the browser prints, at 1:1 — see the `@media print`
 * rules in styles.css.
 */
export function Sticker({
  qrSvg,
  publicCode,
  testId = 'sticker',
}: StickerProps) {
  return (
    <div className="sticker" data-testid={testId}>
      <div
        className="sticker__qr"
        // The SVG comes from the local QR library, given a payload this app
        // built from its own saved record — never from user input, never from
        // the network.
        dangerouslySetInnerHTML={{ __html: qrSvg }}
        aria-hidden="true"
      />
      <p className="sticker__code">{publicCode}</p>
    </div>
  )
}
