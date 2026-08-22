import { cn } from '@/lib/ui/cn'
import type { ConceptRating } from './fixtures'

/*
 * One 1-7 question, its average, and the shape of the answers.
 *
 * An open horizontal row rather than a card or a chart. Four of these sit under
 * one another and have to be comparable at a glance, which a row of four
 * bordered tiles actively prevents: the eye reads the borders as the structure
 * and the numbers as decoration inside them.
 *
 * ## The distribution is not a picture
 *
 * Each column carries its value (1 to 7), a bar whose height is its share of
 * the largest bucket, and the count as a number. The bar is the fastest read
 * and the number is the authoritative one, so nothing depends on estimating a
 * length, and nothing depends on colour: a reader with any colour vision
 * deficiency, or a laptop in daylight, still has the digits.
 *
 * `aria-hidden` on the bars, because they say exactly what the numbers beneath
 * them already say, and a screen reader announcing seven unlabelled shapes
 * after seven labelled counts is noise.
 *
 * No gauges, no speedometers, no headlamps. This is a report.
 */

interface RatingRowProps {
  readonly rating: ConceptRating
}

export function RatingRow({ rating }: RatingRowProps) {
  const peak = Math.max(...rating.distribution, 1)

  return (
    <div className="flex flex-col gap-3 border-t border-line py-5 first:border-t-0 first:pt-0 lg:flex-row lg:items-start lg:gap-8">
      <p className="min-w-0 flex-1 font-body text-base text-ink lg:pt-1">
        {rating.prompt}
      </p>

      {/*
        The average in its own column rather than under the prompt, so the four
        questions' figures line up vertically. Comparing them is the whole
        reason they are stacked, and a number that starts at a different x on
        every row has to be hunted for.
      */}
      <p className="flex shrink-0 items-baseline gap-2 lg:w-[11rem] lg:flex-col lg:items-start lg:gap-0.5">
        <span className="flex items-baseline gap-1.5">
          <span className="font-ui text-stat font-semibold leading-none tabular-nums text-ink">
            {rating.average.toFixed(2)}
          </span>
          <span className="font-ui text-base text-muted">/ 7</span>
        </span>
        <span className="font-ui text-small tabular-nums text-faint">
          {rating.answered.toLocaleString()} answers
        </span>
      </p>

      <div className="flex shrink-0 items-end gap-1.5 lg:w-[26rem]">
        {rating.distribution.map((count, index) => {
          const value = index + 1
          const share = count / peak

          return (
            <div key={value} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="font-ui text-caption tabular-nums text-muted">
                {count.toLocaleString()}
              </span>
              {/*
                A visible track, not just a bar.
                
                The first draft drew the fill alone against the page, and the
                small buckets came out as stray dashes floating in space: at
                four answers out of a peak of 464 there is almost nothing to
                draw, and nothing to draw it against. A reader could not tell
                "very few" from "the chart is broken".
                
                So every column has a full-height well with an edge. The seven
                share one baseline and one ceiling, which is also what makes
                the four questions comparable with each other rather than only
                within themselves.
              */}
              <span
                aria-hidden="true"
                className="flex h-14 w-full items-end rounded-[3px] border border-line bg-canvas/80"
              >
                <span
                  className={cn(
                    'w-full rounded-[2px]',
                    value >= 6
                      ? 'bg-ok'
                      : value >= 4
                        ? 'bg-interactive/70'
                        : 'bg-warn',
                  )}
                  /* A non-zero bucket always draws something. */
                  style={{ height: `${Math.max(share * 100, count > 0 ? 4 : 0)}%` }}
                />
              </span>
              <span className="font-ui text-caption tabular-nums text-muted">
                {value}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
