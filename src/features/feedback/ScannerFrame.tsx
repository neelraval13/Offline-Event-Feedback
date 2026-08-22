import { LoaderCircleIcon } from 'lucide-react'
import type { RefObject } from 'react'
import { cn } from '../../lib/ui/cn'

/*
 * The camera, as one focused task.
 *
 * ## The video element is mounted at all times
 *
 * This is the constraint everything else here works around, and it is not a
 * style decision: the scanner attaches a `MediaStream` to a `<video>` that has
 * to already exist when `start()` is called. So the element is always in the
 * tree and the *wrapper* is what hides, exactly as V1 did with
 * `.scanner--hidden`. Nothing here unmounts it, keys it, or moves it between
 * parents, because any of those would drop the stream on the floor and leave
 * the capture light on.
 *
 * The frame footprint is also fixed by `aspect-[4/3]` rather than following the
 * stream. A stream's dimensions are unknown until it starts, so an auto height
 * is zero and then several hundred pixels, shoving whatever is underneath into
 * the operator's thumb at the moment the camera opens. Cropping the preview
 * does not narrow what is decoded: ZXing reads frames from the element, not
 * from its painted box. That reasoning is V1's and it still holds.
 *
 * 4:3 rather than 16:9 because a sticker is held square-on at arm's length; a
 * cinematic frame spends its width on the desk either side of it.
 *
 * ## Nothing sits on top of the video
 *
 * Only the four corner brackets, which are the scan target. Instructions,
 * rejection notices and the two alternate paths all render *below* the frame,
 * in `FeedbackScreen`. A rejection printed over the picture obscures the very
 * thing the operator is trying to aim, and at a venue the frame is often the
 * only bright object on the screen: putting text on it is putting text where
 * the eye is least able to read it.
 */

interface ScannerFrameProps {
  readonly videoRef: RefObject<HTMLVideoElement | null>
  /** `hidden` keeps the element mounted with the stream attached. */
  readonly phase: 'hidden' | 'starting' | 'scanning'
}

export function ScannerFrame({ videoRef, phase }: ScannerFrameProps) {
  const starting = phase === 'starting'

  return (
    <div
      className={cn(
        'relative mx-auto aspect-[4/3] w-full max-w-xl overflow-hidden',
        'rounded-card border border-line-strong bg-black',
        phase === 'hidden' && 'hidden',
      )}
    >
      <video
        ref={videoRef}
        className="size-full object-cover"
        muted
        playsInline
        data-testid="scanner-video"
      />

      {/* The scan target: four brackets, and nothing else over the picture. */}
      {!starting && (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center"
        >
          <div className="relative size-1/2 min-h-40 min-w-40">
            {(
              [
                'top-0 left-0 border-t-2 border-l-2 rounded-tl-chip',
                'top-0 right-0 border-t-2 border-r-2 rounded-tr-chip',
                'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-chip',
                'bottom-0 right-0 border-b-2 border-r-2 rounded-br-chip',
              ] as const
            ).map((corner) => (
              <span
                key={corner}
                className={cn('absolute size-9 border-interactive', corner)}
              />
            ))}
          </div>
        </div>
      )}

      {starting && (
        <div
          role="status"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60"
        >
          <LoaderCircleIcon
            aria-hidden="true"
            className="size-6 animate-spin text-interactive"
          />
          {/* The instruction is text, never only a spinner. */}
          <p className="font-ui text-base text-ink">Starting camera…</p>
        </div>
      )}
    </div>
  )
}
