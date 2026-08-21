/*
 * The V2 design system's public surface.
 *
 * Feature code imports from here, never from `components/ui` directly. That is
 * the boundary that keeps the three layers meaningful:
 *
 *   shadcn / Radix primitives   components/ui        the raw controls
 *   design-system components    this directory       the product's vocabulary
 *   feature UI                  features/*           screens
 *
 * A screen reaching past this barrel into a primitive is how a design system
 * stops being one: it is the moment a button somewhere gets a bespoke size
 * because the primitive allowed it. The primitives stay available for building
 * *new* design-system components, which is what they are for.
 */

export { AppButton } from './AppButton'
export { AppShellV2, type ShellChrome, type ShellNavItem } from './AppShellV2'
export { AppSurface, type SurfaceWidth } from './AppSurface'
export { ConfirmDialog } from './ConfirmDialog'
export { DataTable, type DataColumn, type DataTableProps } from './DataTable'
export { EmptyState } from './EmptyState'
export { ErrorState } from './ErrorState'
export { FormField } from './FormField'
export { LoadingState } from './LoadingState'
export {
  OperationalStatus,
  resolveOperationalStatus,
  type OperationalStatusView,
} from './OperationalStatus'
export { PageHeader } from './PageHeader'
export { Section } from './Section'
export { StatCard } from './StatCard'
export { StatusPill } from './StatusPill'
export { StatusRow } from './StatusRow'
export { useConnection } from './useConnection'
export {
  describeStatus,
  STATUS,
  type StatusDescriptor,
  type StatusKey,
  type StatusTone,
} from './status'
