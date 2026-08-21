import {
  DatabaseIcon,
  DownloadIcon,
  QrCodeIcon,
  SearchIcon,
  UsersIcon,
} from 'lucide-react'
import { useState } from 'react'
import {
  AppButton,
  AppSurface,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  FormField,
  LoadingState,
  PageHeader,
  resolveOperationalStatus,
  Section,
  StatCard,
  StatusPill,
  StatusRow,
  type DataColumn,
} from '@/components/design-system'
import type { OfflineReadiness } from '@/lib/pwa/offlineShell'
import { cn } from '@/lib/ui/cn'
import { STATUS, type StatusKey } from '@/components/design-system/status'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/*
 * The design-system gallery.
 *
 * Every V2 component, on one page, in the states that matter. It exists so the
 * foundation can be reviewed by looking at it rather than by reading source,
 * and so a later change to a token can be checked against the whole system in
 * one glance instead of by clicking through four screens.
 *
 * Deliberately a real route rather than a Storybook: this product already has
 * a build, a service worker and a precache budget that are all carefully
 * accounted for, and adding a second toolchain to look at buttons is not worth
 * that. It is unlisted in the shell navigation for the same reason Reporting
 * is: it is not a station.
 *
 * Nothing here is wired to real data. It renders fixtures.
 */

/** Every status in the vocabulary, so the whole set can be compared at once. */
const ALL_STATUSES = Object.keys(STATUS) as StatusKey[]

/**
 * Every input the shell indicator can be given.
 *
 * Rendered here because the alternative way to review it is to turn off the
 * wifi five times and rebuild the service worker in between.
 */
const SHELL_STATES: readonly {
  readonly readiness: OfflineReadiness
  readonly online: boolean
}[] = [
  { readiness: 'ready', online: true },
  { readiness: 'ready', online: false },
  { readiness: 'preparing', online: true },
  { readiness: 'preparing', online: false },
  { readiness: 'failed', online: true },
  { readiness: 'unsupported', online: true },
  { readiness: 'unsupported', online: false },
]

interface DemoRow {
  readonly code: string
  readonly name: string
  readonly vehicle: string
  readonly responses: number
  readonly status: StatusKey
}

const DEMO_ROWS: readonly DemoRow[] = [
  { code: 'A1-B8EFD9-00001-X', name: 'Ada Lovelace', vehicle: 'Vehicle 2', responses: 1, status: 'synced' },
  { code: 'A1-B8EFD9-00002-K', name: 'Grace Hopper', vehicle: 'Vehicle 1', responses: 2, status: 'pending' },
  { code: 'A1-B8EFD9-00003-M', name: 'Katherine Johnson', vehicle: 'Vehicle 4', responses: 0, status: 'sync-error' },
]

const DEMO_COLUMNS: readonly DataColumn<DemoRow>[] = [
  {
    key: 'code',
    header: 'Code',
    cell: (row) => <span className="font-mono text-small">{row.code}</span>,
  },
  { key: 'name', header: 'Name', cell: (row) => row.name },
  {
    key: 'vehicle',
    header: 'Vehicle',
    hideOnNarrow: true,
    cell: (row) => <span className="text-muted">{row.vehicle}</span>,
  },
  {
    key: 'responses',
    header: 'Responses',
    numeric: true,
    cell: (row) => row.responses,
  },
  {
    key: 'status',
    header: 'Sync',
    cell: (row) => <StatusPill status={row.status} />,
  },
]

export function FoundationScreen() {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'code',
    direction: 'asc',
  })

  return (
    <TooltipProvider delayDuration={200}>
      <AppSurface width="wide" className="flex flex-col gap-page">
        <PageHeader
          eyebrow="V2 Foundation"
          title="Design system"
          description="Every component the V2 foundation provides, in the states that matter. Nothing here is connected to real data."
          status={
            <>
              <StatusPill status="offline-ready" />
              <Badge tone="accent">Phase 1</Badge>
            </>
          }
          action={
            <AppButton>
              <DownloadIcon />
              Primary action
            </AppButton>
          }
        />

        {/* ---- Status vocabulary ---- */}
        <Section
          title="Status"
          description="One vocabulary, resolved through a single table, so the same state cannot look different on two screens. Icon and word first; colour is the third signal, never the only one."
        >
          <div className="flex flex-wrap gap-2">
            {ALL_STATUSES.map((key) => (
              <StatusPill key={key} status={key} />
            ))}
          </div>

          {/*
            Open, not boxed. The rows already separate themselves with rules;
            fencing them in a filled card would be a second edge around a thing
            that has one, which is the habit this pass removed.
          */}
          <div className="border-t border-line">
            <StatusRow
              label="Offline readiness"
              status="offline-ready"
              detail="This device holds everything it needs to work without a network."
            />
            <Separator />
            <StatusRow
              label="Central sync"
              status="not-enrolled"
              detail="Records stay on this device. Keep an encrypted backup."
            />
            <Separator />
            <StatusRow
              label="Pending records"
              status="pending"
              value="12 pending"
              detail="Captured here and not yet delivered to the server."
            />
          </div>
        </Section>

        {/* ---- The shell indicator ---- */}
        <Section
          title="Shell indicator"
          description="What the header shows, for every combination of offline readiness and connectivity. It reports readiness rather than the network, because “Offline ready” is still true, and still reassuring, at the moment the network disappears."
        >
          <div className="border-t border-line">
            {SHELL_STATES.map((state) => {
              const view = resolveOperationalStatus(state.readiness, state.online)

              return (
                <div
                  key={`${state.readiness}-${String(state.online)}`}
                  className={cn(
                    'flex min-w-0 flex-col items-start gap-1.5 border-b border-line py-2.5',
                    // A fixed-width column is a desktop idea. On a phone the
                    // three parts stack rather than forcing the page sideways.
                    'sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1',
                  )}
                >
                  <span className="font-mono text-small text-muted sm:w-44 sm:shrink-0">
                    {state.readiness} · {state.online ? 'network' : 'no network'}
                  </span>
                  <StatusPill
                    status={view.status}
                    label={view.label}
                    title={view.title}
                  />
                  <span className="min-w-0 flex-1 font-body text-small text-faint">
                    {view.title}
                  </span>
                </div>
              )
            })}
          </div>
        </Section>

        {/* ---- Statistics ---- */}
        <Section
          title="Statistics"
          description="Figures get their own treatment, tabular and slashed-zero, so a count that changes while an operator watches it does not change width. Open by default: a rule and a number, the way a specification sheet lists a value."
        >
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Registrations" value="1,284" icon={UsersIcon} caption="Captured at Point A today." />
            <StatCard label="Responses" value="1,109" unit="of 1,284" icon={QrCodeIcon} caption="86.4% coverage." />
            <StatCard label="Pending sync" value="12" icon={DatabaseIcon} status={<StatusPill status="pending" />} />
            <StatCard label="Needs review" value="3" icon={SearchIcon} caption="Codes that matched no registration." />
          </div>

          {/*
            The opt-in, for contrast. A border here is a claim that these two
            belong together and apart from everything else on the page, which is
            true of a selectable tile and untrue of a row of figures.
          */}
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard
              variant="card"
              label="This device"
              value="403"
              unit="records held"
              icon={DatabaseIcon}
              caption="Grouped, because this tile is about one thing: the tablet in your hands."
            />
            <StatCard
              variant="card"
              label="Last backup"
              value="09:41"
              icon={DownloadIcon}
              status={<StatusPill status="synced" />}
            />
          </div>
        </Section>

        {/* ---- Controls ---- */}
        <Section
          title="Controls"
          description="Every target is at least 44px. Operators work standing up, on tablets, several hundred times a shift."
        >
          <div className="flex flex-wrap items-center gap-3">
            <AppButton>Primary</AppButton>
            <AppButton variant="secondary">Secondary</AppButton>
            <AppButton variant="destructive">Delete records</AppButton>
            <AppButton variant="ghost">Ghost</AppButton>
            <AppButton busy busyLabel="Saving…">Save</AppButton>
            <AppButton disabled>Disabled</AppButton>
            <AppButton size="sm" variant="secondary">Small</AppButton>
            <Tooltip>
              <TooltipTrigger asChild>
                <AppButton size="icon" variant="secondary" aria-label="Search">
                  <SearchIcon />
                </AppButton>
              </TooltipTrigger>
              <TooltipContent>
                Tooltips carry definitions, never instructions: they do not
                appear on touch.
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" required hint="As printed on the licence.">
              {(field) => <Input {...field} placeholder="Ada Lovelace" />}
            </FormField>

            <FormField label="Phone number" required error="Enter a valid 10-digit mobile number.">
              {(field) => <Input {...field} defaultValue="12345" inputMode="numeric" />}
            </FormField>

            <FormField label="Vehicle">
              {(field) => (
                <Select>
                  <SelectTrigger id={field.id} aria-describedby={field['aria-describedby']}>
                    <SelectValue placeholder="Select a vehicle" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Vehicle 1</SelectItem>
                    <SelectItem value="2">Vehicle 2</SelectItem>
                    <SelectItem value="3">Vehicle 3</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </FormField>

            <FormField label="Disabled">
              {(field) => <Input {...field} disabled placeholder="Not available" />}
            </FormField>
          </div>
        </Section>

        {/* ---- Messages ---- */}
        <Section
          title="Messages"
          description="Inline and persistent, never a toast. An operator who looks up as a record fails to save must still be able to read why."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <Alert tone="ok">
              <StatusPill status="synced" iconOnly />
              <AlertTitle>Feedback saved on this device</AlertTitle>
              <AlertDescription>Nothing further is needed from the rider.</AlertDescription>
            </Alert>

            <Alert tone="info">
              <StatusPill status="offline" iconOnly />
              <AlertTitle>Working offline</AlertTitle>
              <AlertDescription>
                Records are held on this device and will sync when a network returns.
              </AlertDescription>
            </Alert>

            <ErrorState onRetry={() => undefined}>
              Feedback was <strong>not</strong> saved: the device storage is full.
              The answers below are still here.
            </ErrorState>

            <Alert tone="warn">
              <StatusPill status="pending" iconOnly />
              <AlertTitle>12 records have not synced</AlertTitle>
              <AlertDescription>
                Expected while offline. Take a backup before ending the shift.
              </AlertDescription>
            </Alert>
          </div>
        </Section>

        {/* ---- Data ---- */}
        <Section
          title="Data"
          description="One table pattern: consistent header, row height, alignment and numeric formatting, with loading and empty handled in the component rather than by each screen. Rules rather than a box, so a grid of codes reads as a console and not as a card."
          action={
            <AppButton variant="secondary" size="sm">
              <DownloadIcon />
              Export
            </AppButton>
          }
        >
          <Tabs defaultValue="rows">
            <TabsList>
              <TabsTrigger value="rows">Rows</TabsTrigger>
              <TabsTrigger value="loading">Loading</TabsTrigger>
              <TabsTrigger value="empty">Empty</TabsTrigger>
            </TabsList>

            <TabsContent value="rows">
              <DataTable
                label="Example participants"
                columns={DEMO_COLUMNS}
                rows={DEMO_ROWS}
                rowKey={(row) => row.code}
                sort={sort}
                onSortChange={(key) =>
                  setSort((current) => ({
                    key,
                    direction:
                      current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
                  }))
                }
                onRowClick={() => undefined}
              />
            </TabsContent>

            <TabsContent value="loading">
              <DataTable
                columns={DEMO_COLUMNS}
                rows={[]}
                rowKey={(row: DemoRow) => row.code}
                loading
              />
            </TabsContent>

            <TabsContent value="empty">
              <DataTable
                columns={DEMO_COLUMNS}
                rows={[]}
                rowKey={(row: DemoRow) => row.code}
                empty={
                  <EmptyState
                    icon={UsersIcon}
                    title="No participants in this run"
                    description="Reconciliation has not been run since the last sync, so this run contains nothing yet."
                    action={<AppButton variant="secondary">Run reconciliation</AppButton>}
                  />
                }
              />
            </TabsContent>
          </Tabs>
        </Section>

        {/* ---- Confirmation ---- */}
        <Section
          title="Confirmation"
          description="A dialog stops a queue, so it appears only where it protects an operator from something they cannot undo. The button names the action rather than saying OK."
        >
          <div className="flex flex-wrap items-start gap-3">
            <AppButton variant="destructive" onClick={() => setConfirmOpen(true)}>
              Delete local records
            </AppButton>
            <LoadingState label="Loading example" rows={2} className="max-w-sm flex-1" />
          </div>

          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            destructive
            busy={busy}
            title="Delete every record on this device?"
            description="214 registrations and 189 responses will be permanently removed from this device. If they have not synced, this is the only copy."
            confirmLabel="Delete 403 records"
            onConfirm={() => {
              setBusy(true)
              window.setTimeout(() => {
                setBusy(false)
                setConfirmOpen(false)
              }, 900)
            }}
          />
        </Section>
      </AppSurface>
    </TooltipProvider>
  )
}
