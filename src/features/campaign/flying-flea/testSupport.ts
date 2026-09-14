import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import type { EventLocation } from '../../../config/eventLocations'
import { FLYING_FLEA_CAMPAIGN } from './config'

/*
 * Filling in the campaign registration form, once, for every suite that needs a
 * registered rider before it can test something else.
 *
 * Point A's regression suites care about identity allocation, sticker rendering
 * and print layout, not about which fields the campaign asks for. Keeping the
 * form-filling here means the next campaign changes one helper rather than
 * every test that happens to need a participant.
 */

/*
 * Test-ride time is absent on purpose. It is not a control: the time is the
 * venue clock at submit, attached by `eventStamp.ts`. A helper that could still
 * "fill" it would let a test claim to exercise an input that does not exist.
 *
 * The venue IS a control again, and this helper answers it. The September event
 * runs in two cities, so the form starts with nothing chosen and refuses to
 * submit until one is. A helper that skipped it would make every suite that
 * needs a registered rider fail for a reason none of them are about.
 */
export interface CampaignRiderInput {
  readonly name: string
  readonly phone: string
  readonly email: string
  readonly vehicle?: string
  readonly gender?: string
  readonly drivingLicence?: string
  readonly pincode?: string
  /**
   * The city to record. Defaults to the first, which keeps suites that do not
   * care about location from having to state one.
   */
  readonly location?: EventLocation
}

export const SAMPLE_RIDER: CampaignRiderInput = {
  name: 'Ada Lovelace',
  // The campaign's own rule is a 10-digit Indian mobile.
  phone: '9876543210',
  email: 'ada@example.com',
}

/** Fills the campaign form's required fields, plus any optional ones given. */
export async function fillCampaignRegistration(
  user: UserEvent,
  rider: CampaignRiderInput = SAMPLE_RIDER,
  container: HTMLElement | undefined = undefined,
): Promise<void> {
  const scope = container === undefined ? screen : within(container)

  /*
   * The city first, because it is the first control on the form and because
   * nothing can be saved without it. Selected every time rather than only when
   * the caller names one: a form that opened with a remembered city would
   * accept a no-op selection, and one that did not would fail to submit.
   */
  await user.selectOptions(
    scope.getByLabelText(/^Location/),
    rider.location ?? 'Bengaluru',
  )

  await user.click(
    scope.getByRole('button', {
      name: rider.vehicle ?? (FLYING_FLEA_CAMPAIGN.vehicles[0] as string),
    }),
  )

  const name = scope.getByLabelText(/^Name/)
  await user.clear(name)
  await user.type(name, rider.name)

  const email = scope.getByLabelText(/^Email ID/)
  await user.clear(email)
  await user.type(email, rider.email)

  const phone = scope.getByLabelText(/^Phone Number/)
  await user.clear(phone)
  await user.type(phone, rider.phone)

  if (rider.gender !== undefined) {
    await user.selectOptions(scope.getByLabelText('Gender'), rider.gender)
  }
  if (rider.drivingLicence !== undefined) {
    await user.type(
      scope.getByLabelText('Driving Licence No'),
      rider.drivingLicence,
    )
  }
  if (rider.pincode !== undefined) {
    await user.type(scope.getByLabelText(/^Pincode/), rider.pincode)
  }
}

/**
 * Answers the campaign questionnaire.
 *
 * Every rating question is answered with the same value unless one is named,
 * because most suites need "a complete response" rather than a specific one.
 */
export async function answerCampaignFeedback(
  user: UserEvent,
  ratings: readonly number[] = [4, 4, 4, 4],
  text: { readonly topThreeFeatures?: string; readonly overallExperienceComments?: string } = {},
): Promise<void> {
  const groups = screen.getAllByRole('radiogroup')

  for (const [index, rating] of ratings.entries()) {
    const group = groups[index]
    if (group === undefined) {
      throw new Error(`No rating question at index ${index}`)
    }
    await user.click(
      within(group).getByRole('radio', { name: `Rate ${rating} out of 7` }),
    )
  }

  if (text.topThreeFeatures !== undefined) {
    await user.type(
      screen.getByLabelText(FLYING_FLEA_CAMPAIGN.textQuestions[0]?.prompt ?? ''),
      text.topThreeFeatures,
    )
  }
  if (text.overallExperienceComments !== undefined) {
    await user.type(
      screen.getByLabelText(FLYING_FLEA_CAMPAIGN.textQuestions[1]?.prompt ?? ''),
      text.overallExperienceComments,
    )
  }
}
