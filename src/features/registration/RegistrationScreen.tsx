import { PendingCapabilities } from '../../components/PendingCapabilities'
import { StationBadge } from '../../components/StationBadge'
import { stationFor } from '../../config/event'

/** Point A: the registration terminal. Phase 0 placeholder. */
export function RegistrationScreen() {
  const station = stationFor('registration')

  return (
    <article className="screen">
      <h1>Point A — Registration</h1>
      <p className="screen__lede">
        This device will become the registration terminal. Staff will capture a
        participant's name, phone and email here, and print their QR sticker.
      </p>
      <StationBadge station={station} />
      <PendingCapabilities
        items={[
          'Registration form (name, phone, email)',
          'Participant identity and public fallback code generation',
          'Local durable save — required before a sticker is printed',
          'QR sticker rendering and printing',
        ]}
      />
      <p className="screen__note">
        Operates fully offline. This terminal never depends on Point B.
      </p>
    </article>
  )
}
