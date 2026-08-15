import { FlyingFleaBrandHeader } from '../../../../components/brand/FlyingFleaBrandHeader'
import {
  REGISTRATION_HEADER_ALT,
  REGISTRATION_HEADER_IMAGE,
} from '../assets'
import { FLYING_FLEA_CAMPAIGN } from '../config'
import { EventMeta } from './EventMeta'

/*
 * The top of the registration screen: brand bar, banner, title.
 *
 * The reference's hero is a wide photograph with the page title over a dark
 * gradient. That composition is kept, with two adjustments for a device that is
 * held rather than scrolled:
 *
 *   - the banner is a bounded height rather than 12vw of padding, so the first
 *     field is visible without scrolling on a tablet in portrait
 *   - the scrim is a gradient on the container rather than baked into the
 *     image, so the title is legible over the photograph and the photograph
 *     stays reusable
 *
 * The supplied banner is a street scene: the motorcycle sits left of centre and
 * the rider stands to the right, both around the vertical middle. The crop is
 * weighted to that band, and the title sits at the bottom over the darkest part
 * of the frame, the shadowed road, rather than over either subject.
 */

interface CampaignHeroHeaderProps {
  /** The word rendered in the campaign's lime, e.g. "Registration". */
  readonly accent: string
  readonly lead: string
  /** The station line under the title. */
  readonly subtitle: string
}

export function CampaignHeroHeader({
  accent,
  lead,
  subtitle,
}: CampaignHeroHeaderProps) {
  return (
    <header className="ff-hero">
      {/* No venue badge here: `EventMeta` below states it once, with the date,
          and the same venue printed twice on one screen is noise. */}
      <FlyingFleaBrandHeader />

      <div className="ff-hero__banner">
        <img
          className="ff-hero__image"
          src={REGISTRATION_HEADER_IMAGE}
          alt={REGISTRATION_HEADER_ALT}
          /* Above the fold: never lazy, and the box is reserved in CSS so the
             photograph arriving cannot push the form down. */
          loading="eager"
          decoding="async"
          draggable={false}
        />

        <div className="ff-hero__content">
          <div className="ff-eyebrow">{FLYING_FLEA_CAMPAIGN.hero.eyebrow}</div>
          <h1 className="ff-display ff-heading">
            {lead} <span className="ff-heading__accent">{accent}</span>
          </h1>
          <p className="ff-sub">{subtitle}</p>
        </div>
      </div>

      <EventMeta />
    </header>
  )
}
