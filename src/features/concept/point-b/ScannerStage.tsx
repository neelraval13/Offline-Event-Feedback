import { CameraIcon, LoaderCircleIcon } from 'lucide-react'
import { cn } from '@/lib/ui/cn'

/*
 * The camera, as one focused task.
 *
 * ## A drawn fixture, not a camera
 *
 * This renders a placeholder where the `<video>` element goes. The concept is a
 * design review, and opening a real camera to show what a camera looks like
 * would ask the reviewer for a permission prompt in order to look at a layout.
 * In production the same frame holds the existing preview element, which is
 * mounted before the camera starts and only revealed while scanning: that
 * ordering is the scanner's, and this concept does not change it.
 *
 * ## Nothing sits on top of the video
 *
 * Only the four corner brackets, which are the scan target. Instructions,
 * rejection notices and the two alternate paths are all *below* the frame. A
 * rejection printed over the picture obscures the very thing the operator is
 * trying to aim, and at a venue the frame is often the only bright object on
 * the screen: putting text on it is putting text where the eye is least able to
 * read it.
 *
 * ## The frame is 4:3, not 16:9
 *
 * A sticker is held up square-on at arm's length. A cinematic frame wastes its
 * width on the desk either side of it and, on a phone held upright, leaves a
 * target barely taller than the sticker itself.
 */

type ScannerPhase = 'starting' | 'scanning'

interface ScannerStageProps {
  readonly phase: ScannerPhase
}

export function ScannerStage({ phase }: ScannerStageProps) {
  const starting = phase === 'starting'

  return (
    <div
      className={cn(
        'relative mx-auto aspect-[4/3] w-full max-w-xl overflow-hidden',
        'rounded-card border border-line-strong bg-black',
      )}
    >
      {/*
        Stand-in for the camera preview. In production this region is the
        existing `<video>`; nothing else about the frame changes.
      */}
      <div
        data-testid="concept-camera"
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_40%,#1c2224,#050607)]"
      >
        <CameraIcon className="size-10 text-white/10" />
      </div>

      {/* The scan target: four brackets, and nothing else over the picture. */}
      {!starting && (
        <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
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
          className="absolute inset-0 flex flex-col items-center justify-center gap-3"
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
