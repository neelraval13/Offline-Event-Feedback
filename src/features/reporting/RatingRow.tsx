import { cn } from '@/lib/ui/cn'
import type { CampaignRatingSummary } from '../../lib/reporting/types'

/*
 * One campaign rating question, its average, and the shape of the answers.
 *
 * An open horizontal row rather than a card or a chart. The four questions sit
 * under one another and have to be comparable at a glance, which a row of four
 * bordered tiles actively prevents: the eye reads the borders as the structure
 * and the numbers as decoration inside them. The average sits in its own column
 * so the four line up vertically, which is the whole reason they are stacked.
 *
 * ## The distribution is not a picture
 *
 * Each column carries its value (1 to 7), a bar sized against the largest
 * bucket, and the exact count as a number. The bar is the fastest read and the
 * number is the authoritative one, so nothing depends on estimating a length
 * and nothing depends on colour: a reader with a colour vision deficiency, or a
 * laptop in daylight, still has the digits.
 *
 * Every column has a full-height well with an edge. Without it, a bucket of 4
 * against a peak of 464 drew as a stray dash floating in space, and a reader
 * could not tell "very few" from "the chart is broken". A zero draws an empty
 * well, which is visibly different from a missing column.
 *
 * `aria-hidden` on the bars: they say exactly what the numbers beneath them
 * already say, and a screen reader announcing seven unlabelled shapes after
 * seven labelled counts is noise.
 *
 * No gauges, no speedometers, no headlamps, and no charting library. This is a
 * report.
 */

const VALUES = [1, 2, 3, 4, 5, 6, 7] as const

interface RatingRowProps {
  readonly rating: CampaignRatingSummary
}

export function RatingRow({ rating }: RatingRowProps) {
  const counts = VALUES.map((value) => rating.distribution[value])
  const peak = Math.max(...counts, 1)

  return (
    <div className="flex flex-col gap-3 border-t border-line py-5 first:border-t-0 first:pt-0 lg:flex-row lg:items-start lg:gap-8">
      <p className="min-w-0 flex-1 font-body text-base text-ink lg:pt-1">
        {rating.prompt}
      </p>

      <p className="flex shrink-0 items-baseline gap-2 lg:w-[11rem] lg:flex-col lg:items-start lg:gap-0.5">
        <span className="flex items-baseline gap-1.5">
          <span className="font-ui text-stat font-semibold leading-none tabular-nums text-ink">
            {rating.average === null ? 'No data' : rating.average.toFixed(2)}
          </span>
          {rating.average !== null && (
            <span className="font-ui text-base text-muted">/ 7</span>
          )}
        </span>
        <span className="font-ui text-small tabular-nums text-faint">
          {rating.responses.toLocaleString()} answers
        </span>
      </p>

      <div className="flex shrink-0 items-end gap-1.5 lg:w-[26rem]">
        {VALUES.map((value, index) => {
          const count = counts[index] ?? 0
          const share = count / peak

          return (
            <div key={value} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="font-ui text-caption tabular-nums text-muted">
                {count.toLocaleString()}
              </span>
              <span
                aria-hidden="true"
                className="flex h-14 w-full items-end rounded-[3px] border border-line bg-canvas/80"
              >
                <span
                  className={cn(
                    'w-full rounded-[2px]',
                    value >= 6 ? 'bg-ok' : value >= 4 ? 'bg-interactive/70' : 'bg-warn',
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
