import { LogOutIcon } from 'lucide-react'
import { useState } from 'react'
import { AppSurface } from '../../../components/design-system'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '../../../components/ui/tabs'
import { ConceptStateBar } from './ConceptStateBar'
import { DuplicatesConcept } from './DuplicatesConcept'
import { ExportConcept } from './ExportConcept'
import { LoginConcept } from './LoginConcept'
import { NeedsReviewConcept } from './NeedsReviewConcept'
import { OverviewConcept } from './OverviewConcept'
import { ParticipantSheet } from './ParticipantSheet'
import { ParticipantsConcept } from './ParticipantsConcept'
import { ResponseSheet } from './ResponseSheet'
import { ResponsesConcept } from './ResponsesConcept'
import { SnapshotBar } from './SnapshotBar'
import {
  COUNTS,
  EVENT,
  LATEST_RUN,
  HISTORICAL_COUNTS,
  RUNS,
  SECTIONS,
  type ConceptParticipant,
  type ConceptResponse,
  type DataState,
  type RunState,
  type Section,
  type SessionState,
} from './fixtures'

/*
 * Central Reporting V2, as a concept.
 *
 * ## This route touches nothing
 *
 * No reporting API is called, no secret is sent, no reconciliation is run, no
 * file is downloaded, nothing is read from IndexedDB or from the central
 * database, and no network request is made at all. Everything on screen comes
 * from `fixtures.ts`, which is a plain object graph of invented people. None of
 * `reportingClient`, `useReportingSession`, `ReportingSessionProvider` or any
 * other effectful reporting function is imported, and a test asserts that.
 *
 * The real `/#/reporting` is untouched by this phase.
 *
 * ## The shape being proposed
 *
 *   credential gate            centred, narrow, no persistence offered
 *   header                     what this is, which event, and Sign out
 *   snapshot rail              which run, and whether it still describes the
 *                              event. Above the sections, on every section.
 *   section navigation         the same six sections the real screen has
 *   section                    Overview, Participants, Responses, Needs review,
 *                              Duplicates, Export
 *
 * The snapshot rail sits above the navigation rather than inside Overview
 * because the person exporting a file is the person least likely to have read a
 * warning on another tab, and a file is the thing that outlives the screen.
 *
 * ## Sign out is not navigation
 *
 * It destroys the in-memory session. There is nothing to persist and nothing to
 * clear from storage, because the secret was never written anywhere: it lives
 * in React state for the life of the tab. The button says what it does.
 */

export function ReportingConcept() {
  const [session, setSession] = useState<SessionState>('signed-in')
  const [runState, setRunState] = useState<RunState>('latest')
  const [section, setSection] = useState<Section>('overview')
  const [data, setData] = useState<DataState>('healthy')

  const [reconciling, setReconciling] = useState(false)
  const [participant, setParticipant] = useState<ConceptParticipant | null>(null)
  const [response, setResponse] = useState<ConceptResponse | null>(null)

  const historical = runState === 'historical'
  const run = (historical ? RUNS[1] : RUNS[0]) ?? LATEST_RUN
  const counts = historical ? HISTORICAL_COUNTS : COUNTS

  function reconcile() {
    setReconciling(true)
    /*
     * Concept only: nothing is read and no run is written. The real operation
     * returns to the latest run afterwards, which is what this imitates.
     */
    window.setTimeout(() => {
      setReconciling(false)
      setRunState('latest')
    }, 1400)
  }

  const stateBar = (
    <ConceptStateBar
      session={session}
      onSession={setSession}
      run={runState}
      onRun={setRunState}
      section={section}
      onSection={setSection}
      data={data}
      onData={setData}
    />
  )

  if (session !== 'signed-in') {
    return (
      <AppSurface width="wide" className="flex flex-col gap-page">
        {stateBar}
        <LoginConcept
          rejected={session === 'rejected'}
          onSubmit={() => setSession('signed-in')}
        />
      </AppSurface>
    )
  }

  return (
    <AppSurface width="wide" className="flex flex-col gap-page">
      {stateBar}

      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-ui text-label font-semibold uppercase tracking-[0.16em] text-accent">
            Central Reporting
          </span>
          {/* No counts in the title: they belong to a run, and the title does
              not change when the run does. */}
          <h1 className="font-display text-page leading-none tracking-wide text-ink">
            Event report
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <p className="flex flex-col text-right font-ui text-small leading-tight text-muted">
            <span>{EVENT.name}</span>
            <span className="text-faint">{EVENT.day}</span>
          </p>
          <button
            type="button"
            onClick={() => setSession('logged-out')}
            className="inline-flex min-h-touch items-center gap-2 rounded-control border border-line px-3.5 font-ui text-small text-muted transition-colors hover:border-line-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive"
          >
            <LogOutIcon aria-hidden="true" className="size-4" />
            Sign out
          </button>
        </div>
      </header>

      <SnapshotBar
        runState={runState}
        run={run}
        onRunState={setRunState}
        reconciling={reconciling}
        onReconcile={reconcile}
        {...(section === 'export' ? { context: 'export' as const } : {})}
      />

      {/*
        Six sections, always six. Merging any of them to fit a narrow viewport
        would hide evidence to save horizontal space. Tabs on a laptop, a Select
        on a phone: six compressed tabs on a 440px screen is either an overflow
        or six unreadable labels.
      */}
      <nav aria-label="Reporting sections">
        <div className="hidden md:block">
          <Tabs value={section} onValueChange={(value) => setSection(value as Section)}>
            <TabsList>
              {SECTIONS.map((entry) => (
                <TabsTrigger key={entry.key} value={entry.key}>
                  {entry.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="md:hidden">
          <label htmlFor="section-picker" className="sr-only">
            Reporting section
          </label>
          <Select value={section} onValueChange={(value) => setSection(value as Section)}>
            <SelectTrigger id="section-picker" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SECTIONS.map((entry) => (
                <SelectItem key={entry.key} value={entry.key}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </nav>

      <section aria-labelledby="section-heading" className="flex flex-col">
        <h2 id="section-heading" className="sr-only">
          {SECTIONS.find((entry) => entry.key === section)?.label}
        </h2>

        {section === 'overview' && (
          <OverviewConcept
            runState={runState}
            data={data}
            counts={counts}
            onOpenSection={setSection}
          />
        )}

        {section === 'participants' && (
          <ParticipantsConcept data={data} onOpen={setParticipant} />
        )}

        {section === 'responses' && (
          <ResponsesConcept data={data} onOpen={setResponse} />
        )}

        {section === 'review' && (
          <NeedsReviewConcept
            data={data}
            onOpenParticipant={setParticipant}
            onOpenResponse={setResponse}
          />
        )}

        {section === 'duplicates' && <DuplicatesConcept data={data} />}

        {section === 'export' && <ExportConcept runState={runState} />}
      </section>

      <ParticipantSheet participant={participant} onClose={() => setParticipant(null)} />
      <ResponseSheet response={response} onClose={() => setResponse(null)} />
    </AppSurface>
  )
}
