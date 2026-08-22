import { cn } from '@/lib/ui/cn'

/*
 * The printed label, on screen, at its physical size.
 *
 * V1 renders this at 50mm x 40mm so the operator is looking at the real
 * artefact rather than a picture of one, and that is kept exactly: a preview
 * scaled to "about right" cannot tell you the code will fit, and the code
 * fitting on one line is a printed-contract property the existing tests pin.
 *
 * The sticker itself stays what it is, which is the privacy boundary of the
 * whole product: a QR symbol and a public code, and nothing else. No name, no
 * phone, no email, no licence. Somebody wears this in public and cannot see
 * what it says about them, so it says nothing about them.
 *
 * White, because it is paper. This is the one surface in V2 that is deliberately
 * not on the dark palette, and the frame around it says so: the label sits on a
 * quiet plinth rather than floating on the page, which also stops a white
 * rectangle from reading as a rendering error on a near-black screen.
 *
 * The concept renders a real QR from an invented payload. See `fixtures.ts`.
 */

export const STICKER_WIDTH_MM = 50
export const STICKER_HEIGHT_MM = 40

interface StickerPreviewProps {
  readonly qrSvg: string
  readonly publicCode: string
  readonly className?: string
}

export function StickerPreview({
  qrSvg,
  publicCode,
  className,
}: StickerPreviewProps) {
  return (
    <div
      className={cn(
        'inline-flex flex-col items-center gap-2 rounded-card border border-line bg-surface p-3',
        className,
      )}
    >
      <div
        data-testid="concept-sticker"
        className="flex flex-col items-center justify-center gap-1 bg-white"
        style={{
          width: `${STICKER_WIDTH_MM}mm`,
          height: `${STICKER_HEIGHT_MM}mm`,
        }}
      >
        <div
          className="w-[26mm] [&>svg]:block [&>svg]:size-full"
          // Local, deterministic markup from the QR library, given a payload
          // this concept invented. Never user input, never the network.
          dangerouslySetInnerHTML={{ __html: qrSvg }}
          aria-hidden="true"
        />
        <p className="font-mono text-[2.6mm] leading-none tracking-tight whitespace-nowrap text-black">
          {publicCode}
        </p>
      </div>

      <p className="font-ui text-caption uppercase tracking-[0.16em] text-faint">
        {STICKER_WIDTH_MM} x {STICKER_HEIGHT_MM} mm
      </p>
    </div>
  )
}
