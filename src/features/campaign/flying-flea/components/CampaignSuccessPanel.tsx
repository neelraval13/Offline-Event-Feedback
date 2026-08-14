import { FLYING_FLEA_CAMPAIGN } from '../config'

/*
 * What a rider sees after their feedback is stored.
 *
 * The wording is the campaign's own thank-you. It appears the moment the record
 * is committed to this device, and says nothing about delivery: the tablet is
 * routinely offline, and a message that implied the response had reached a
 * server would be false for hours.
 */

interface CampaignSuccessPanelProps {
  /** Rendered under the thank-you, e.g. what staff should do next. */
  readonly detail?: string
}

export function CampaignSuccessPanel({ detail }: CampaignSuccessPanelProps) {
  return (
    <div className="ff-success" role="status">
      <div className="ff-success__tick" aria-hidden="true">
        ✓
      </div>
      <h2 className="ff-display ff-success__title">Feedback Submitted</h2>
      <p className="ff-success__body">{FLYING_FLEA_CAMPAIGN.thanks}</p>
      {detail !== undefined && <p className="ff-success__body">{detail}</p>}
    </div>
  )
}
