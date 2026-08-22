import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTES } from '@/app/routes'
import { STATUS, type StatusKey } from '@/components/design-system/status'

/*
 * The concept is a prototype, and this is what keeps it one.
 *
 * Device Admin is the screen with the most dangerous imports available to it:
 * it is the only place in the product that can wipe a passphrase into an
 * encrypted file, merge a foreign backup into the local store, enrol the device
 * against a server, or reload the terminal onto a new build. A design prototype
 * that could reach any of those is one keystroke from doing it during a review.
 *
 * So the isolation is a property of the build rather than of everybody
 * remembering, and the forbidden list here is longer than the other two
 * concepts' for that reason.
 */

const CONCEPT_DIR = 'src/features/concept/admin'

function conceptSources(): { name: string; source: string }[] {
  return readdirSync(CONCEPT_DIR)
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.test.ts'))
    .map((file) => ({
      name: file,
      source: readFileSync(join(CONCEPT_DIR, file), 'utf8'),
    }))
}

function conceptImports(): { name: string; specifier: string }[] {
  return conceptSources().flatMap(({ name, source }) =>
    [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => ({
      name,
      specifier: match[1] as string,
    })),
  )
}

function conceptBindings(): string[] {
  return conceptSources().flatMap(({ source }) =>
    [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap((match) =>
      (match[1] as string).split(',').map((name) => name.trim()),
    ),
  )
}

const all = () =>
  conceptSources()
    .map((file) => file.source)
    .join('\n')

/** Whole modules a visual prototype has no business reaching. */
const FORBIDDEN_MODULES = [
  'lib/storage',
  'lib/sync',
  'lib/backup',
  'lib/pwa',
  'lib/scanner',
  'useDeviceDiagnostics',
  'AdminScreen',
  'BackupPanel',
  'SyncPanel',
  'LocalDataPanel',
  'OfflineReadinessPanel',
]

/** The specific things that would actually do something irreversible. */
const FORBIDDEN_BINDINGS = [
  'db',
  'getLocalCounts',
  'getDatabaseStatus',
  'getOrCreateDeviceId',
  'peekDeviceId',
  'runSync',
  'enrollDevice',
  'readSyncCredential',
  'storeSyncCredential',
  'readSyncActivity',
  'createEncryptedBackup',
  'verifyBackupFile',
  'restoreBackup',
  'downloadTextFile',
  'recordBackupEvent',
  'readBackupMetadata',
  'applyPendingUpdate',
  'useOfflineShellState',
]

describe('the Device Admin concept', () => {
  it('cannot reach storage, sync, backup or the PWA shell', () => {
    for (const { name, specifier } of conceptImports()) {
      for (const forbidden of FORBIDDEN_MODULES) {
        expect(
          specifier.includes(forbidden),
          `${name} imports ${specifier}, which a visual prototype must not touch`,
        ).toBe(false)
      }
    }
  })

  it('imports nothing that could write, send, enrol or reload', () => {
    const bindings = conceptBindings()

    for (const forbidden of FORBIDDEN_BINDINGS) {
      expect(bindings, `the concept imports ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('asks no network and downloads no file', () => {
    const source = all()

    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toContain('XMLHttpRequest')
    expect(source).not.toContain('navigator.serviceWorker')
    expect(source).not.toContain('createObjectURL')
    expect(source).not.toContain('location.reload')
  })

  it('carries no participant data of any kind', () => {
    /*
     * A support screen never needs a name, and a screen facing a desk should
     * not have one on it. The fixtures are counts, timestamps and technical
     * identifiers; this fails if anybody adds a person to them.
     */
    const fixtures = readFileSync(join(CONCEPT_DIR, 'fixtures.ts'), 'utf8')

    for (const field of [
      'respondentName',
      'respondentEmail',
      'respondentPhone',
      'drivingLicence',
      'pincode',
      'publicCode',
      'participantId',
    ]) {
      expect(fixtures, `fixtures mention ${field}`).not.toContain(field)
    }
    // No email address, and no ten-digit number that could be a phone.
    expect(fixtures).not.toMatch(/[\w.]+@[\w.]+/)
    expect(fixtures).not.toMatch(/\b[6-9]\d{9}\b/)
  })

  it('speaks the V2 status vocabulary rather than inventing one', () => {
    /*
     * Every status the console shows resolves through the shared table, so a
     * state cannot look one way here and another way on Point A. This checks
     * the concept only names keys that exist.
     */
    const named = [...all().matchAll(/status="([a-z-]+)"/g)].map(
      (match) => match[1] as string,
    )

    expect(named.length).toBeGreaterThan(0)
    for (const key of named) {
      expect(Object.keys(STATUS), `unknown status ${key}`).toContain(key)
    }
  })

  it('keeps the readiness and sync states truthful to the vocabulary', () => {
    /*
     * The two rules this screen must not break: being unable to reach the
     * server is not a failure, and being unable to write locally is.
     */
    expect(STATUS.pending.tone).toBe('warn')
    expect(STATUS['sync-error'].tone).toBe('danger')
    expect(STATUS['offline-ready'].tone).toBe('ok')
    expect(STATUS['not-enrolled'].tone).not.toBe('danger')

    const source = all()
    // The unreachable branch must not be painted with the error status.
    expect(source).toContain("case 'unreachable':")
    expect(source).toMatch(/case 'unreachable':[\s\S]{0,200}?return 'pending'/)
  })

  it('did not replace the production admin console', () => {
    const admin = ROUTES.find((route) => route.path === '/admin')

    expect(admin).toBeDefined()
    expect(admin?.title).toBe('Device Admin')
    expect(admin?.showInNav).toBe(true)
    // Full chrome: Admin is a support surface, not a rider mid-flow.
    expect(admin?.chrome).toBeUndefined()
    expect(admin?.path).not.toBe('/concept/admin')
  })

  it('is unlisted, full-chrome and on its own path', () => {
    const concept = ROUTES.find((route) => route.path === '/concept/admin')

    expect(concept).toBeDefined()
    expect(concept?.showInNav).toBe(false)
    /*
     * Deliberately not `minimal`, unlike the two station concepts. Whoever is
     * on Device Admin has reason to move between stations, and nobody is
     * mid-capture.
     */
    expect(concept?.chrome).toBeUndefined()
  })
})

describe('the status keys the console uses', () => {
  it('are all real', () => {
    const keys: StatusKey[] = [
      'offline-ready',
      'offline-preparing',
      'offline-failed',
      'offline-unsupported',
      'enrolled',
      'not-enrolled',
      'syncing',
      'synced',
      'pending',
      'sync-error',
      'unknown',
    ]

    for (const key of keys) {
      expect(STATUS[key], `${key} is missing from the vocabulary`).toBeDefined()
    }
  })
})
