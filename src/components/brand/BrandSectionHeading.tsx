/*
 * A campaign section heading: step number, display title, optional sub-line.
 *
 * The step number is the supplied design's way of telling staff how far through
 * a registration they are; it is presentational and carries no state.
 */

interface BrandSectionHeadingProps {
  /** e.g. "Step 01". Omitted for sections that are not part of a sequence. */
  readonly step?: string
  readonly title: string
  readonly subtitle?: string
  /** Associates the heading with the region it titles. */
  readonly id?: string
}

export function BrandSectionHeading({
  step,
  title,
  subtitle,
  id,
}: BrandSectionHeadingProps) {
  return (
    <div className="ff-card__head">
      {step !== undefined && <div className="ff-eyebrow">{step}</div>}
      <h2 id={id} className="ff-display ff-heading">
        {title}
      </h2>
      {subtitle !== undefined && <p className="ff-sub">{subtitle}</p>}
    </div>
  )
}
