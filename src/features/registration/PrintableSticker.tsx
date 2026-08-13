import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sticker } from './Sticker'
import type { PublicParticipantCode } from '../../types'

/** Container in `index.html`, a sibling of the application root. */
export const PRINT_ROOT_ID = 'print-root'

/**
 * Finds the print container, creating it if the host page has none.
 *
 * The application's own `index.html` provides it. Tests — and any future host
 * that renders this app into an arbitrary page — get one made for them, so the
 * component never silently fails to produce a printable label.
 */
function usePrintRoot(): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let node = document.getElementById(PRINT_ROOT_ID)

    if (node === null) {
      node = document.createElement('div')
      node.id = PRINT_ROOT_ID
      document.body.appendChild(node)
    }

    setContainer(node)
  }, [])

  return container
}

interface PrintableStickerProps {
  readonly qrSvg: string
  readonly publicCode: PublicParticipantCode
}

/**
 * The sticker as the printer receives it, rendered outside the application's
 * DOM subtree.
 *
 * Why a portal rather than printing the on-screen preview in place:
 *
 * The sticker sits several levels deep inside the app. Hiding its ancestors
 * with `visibility: hidden` leaves them occupying layout, so the document stays
 * as tall as the registration screen — six pages at a 40 mm page height — and
 * anchoring the label with `position: fixed` then repeats it on every one of
 * them. That is precisely the six-identical-pages defect from physical QA.
 *
 * Portalling the label to a sibling of `#root` lets print simply switch the
 * application off with `display: none`. The document then contains one element,
 * 50 mm x 40 mm, in normal flow: exactly one page, exactly one sticker, with no
 * fixed positioning anywhere.
 *
 * The screen preview is a second instance of the same component with the same
 * props, so the two cannot disagree about what is being printed.
 */
export function PrintableSticker({ qrSvg, publicCode }: PrintableStickerProps) {
  const container = usePrintRoot()

  if (container === null) {
    return null
  }

  return createPortal(
    <Sticker qrSvg={qrSvg} publicCode={publicCode} testId="sticker-print" />,
    container,
  )
}
