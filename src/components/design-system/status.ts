import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleSlashIcon,
  CloudOffIcon,
  HelpCircleIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  WifiIcon,
  XCircleIcon,
  type LucideIcon,
} from 'lucide-react'

/*
 * The operational state vocabulary.
 *
 * This module is the single answer to "what does this state look like?". Every
 * status anywhere in the product resolves through the table below, so
 * "Ready for offline use" cannot be a green badge on Device Admin and grey
 * body text somewhere else. It was exactly that before V2: Admin rendered
 * every state, from a device UUID to "Not ready, connect this device to the
 * Internet", as identical monospace text in a definition list, which made the
 * one line an operator urgently needed to see indistinguishable from the eight
 * lines they did not.
 *
 * ## Never colour alone
 *
 * Every descriptor carries an icon and a label as well as a tone. Three
 * reasons, all of them things that actually happen at an event:
 *
 *   - Around one man in twelve has some form of colour vision deficiency, and
 *     amber against green is the common confusion.
 *   - These screens are read outdoors, on a tablet, at an angle, in daylight
 *     that flattens a dark interface until the tints are nearly identical.
 *   - Operators glance rather than read. A shape and a word survive a glance;
 *     a hue does not.
 *
 * The tone is the third signal, not the first.
 *
 * ## Why `busy` is amber and `offline` is not red
 *
 * Offline is the normal, expected, designed-for condition of this product. The
 * client's favourite property is that it keeps working without a network.
 * Colouring it red would tell an operator something is wrong several hundred
 * times a day until they stopped reading status colours at all. Offline is
 * informational. Only a genuine failure is red.
 */

/**
 * The semantic tones, matching the status ramp in the theme.
 *
 * Deliberately named for meaning rather than for colour: a later palette
 * change should not require every call site to stop saying "green".
 */
export type StatusTone = 'neutral' | 'ok' | 'busy' | 'warn' | 'danger' | 'info'

export interface StatusDescriptor {
  readonly tone: StatusTone
  /** The word an operator reads. Short enough to survive a glance. */
  readonly label: string
  readonly icon: LucideIcon
  /** True while the state is expected to resolve on its own. Spins the icon. */
  readonly inProgress?: boolean
}

/**
 * Every operational state the product can be in.
 *
 * One flat vocabulary rather than one enum per feature, because the same words
 * mean the same thing whether they describe a device, a record or a network:
 * `syncing` on the Admin screen and `syncing` beside a record are one state and
 * must look like it.
 */
export type StatusKey =
  /* Connectivity */
  | 'online'
  | 'offline'
  /* Delivery to the central server */
  | 'synced'
  | 'syncing'
  | 'pending'
  | 'sync-error'
  /* Device preparation for the field */
  | 'offline-ready'
  | 'offline-preparing'
  | 'offline-failed'
  | 'offline-unsupported'
  /* Central sync enrolment */
  | 'enrolled'
  | 'not-enrolled'
  /* Generic */
  | 'unknown'

export const STATUS: Readonly<Record<StatusKey, StatusDescriptor>> = {
  online: { tone: 'ok', label: 'Online', icon: WifiIcon },
  /*
   * Informational, never a warning. See the note above: this is the condition
   * the product is designed around, not a fault to be flagged.
   */
  offline: { tone: 'info', label: 'Offline', icon: CloudOffIcon },

  synced: { tone: 'ok', label: 'Synced', icon: CheckCircle2Icon },
  syncing: {
    tone: 'busy',
    label: 'Syncing',
    icon: LoaderCircleIcon,
    inProgress: true,
  },
  /*
   * Records held locally and not yet delivered. Amber rather than red: on a
   * device that has been offline all morning this is the correct and expected
   * state of every record on it.
   */
  pending: { tone: 'warn', label: 'Pending', icon: CircleDashedIcon },
  'sync-error': { tone: 'danger', label: 'Sync error', icon: XCircleIcon },

  'offline-ready': {
    tone: 'ok',
    label: 'Ready for offline use',
    icon: CheckCircle2Icon,
  },
  'offline-preparing': {
    tone: 'busy',
    label: 'Preparing',
    icon: RefreshCwIcon,
    inProgress: true,
  },
  /*
   * The one state on the Admin screen that must stop an operator. A device
   * that reads this and goes to the venue anyway loses everything captured on
   * it the moment the browser is closed.
   */
  'offline-failed': { tone: 'danger', label: 'Not ready', icon: AlertTriangleIcon },
  'offline-unsupported': {
    tone: 'neutral',
    label: 'Not available',
    icon: CircleSlashIcon,
  },

  enrolled: { tone: 'ok', label: 'Enrolled', icon: CheckCircle2Icon },
  /*
   * Not an error. A station device is perfectly usable unenrolled; it simply
   * keeps its records locally, which is what the backup exists for.
   */
  'not-enrolled': { tone: 'neutral', label: 'Not enrolled', icon: CircleSlashIcon },

  unknown: { tone: 'neutral', label: 'Unknown', icon: HelpCircleIcon },
}

/** Resolves a status key to its descriptor, falling back to `unknown`. */
export function describeStatus(key: StatusKey): StatusDescriptor {
  return STATUS[key] ?? STATUS.unknown
}
