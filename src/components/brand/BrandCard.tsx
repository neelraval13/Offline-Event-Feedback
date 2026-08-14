import type { ReactNode } from 'react'

/** A campaign panel. Presentation only. */
export function BrandCard({
  children,
  labelledBy,
}: {
  readonly children: ReactNode
  /** Id of the heading this card is titled by, when it has one. */
  readonly labelledBy?: string
}) {
  return (
    <section className="ff-card" aria-labelledby={labelledBy}>
      {children}
    </section>
  )
}
