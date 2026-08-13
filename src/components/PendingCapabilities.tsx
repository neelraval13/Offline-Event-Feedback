interface PendingCapabilitiesProps {
  /** What this surface becomes once later phases land. */
  readonly items: readonly string[]
}

/**
 * Placeholder used by every Phase 0 screen to state plainly what the surface
 * will do, so a scaffold screen is never mistaken for a broken one.
 */
export function PendingCapabilities({ items }: PendingCapabilitiesProps) {
  return (
    <section className="pending">
      <h2 className="pending__title">Not implemented yet</h2>
      <ul className="pending__list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  )
}
