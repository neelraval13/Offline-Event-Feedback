#!/usr/bin/env node
/**
 * Fails if U+2014, the em dash, appears in any first-party text file.
 *
 * The em dash is banned from this repository's own text: UI copy, comments,
 * documentation, tests, migrations and configuration alike. Punctuation is
 * rewritten to fit the sentence instead, so this check exists to stop one
 * creeping back in through a later edit, a paste from a document, or a
 * generated comment.
 *
 * Deliberately dependency-free and deliberately part of `pnpm build`, ahead of
 * compilation: a check that only runs when someone remembers to run it is not a
 * check. It reads nothing that is git-ignored, so `.env` and `.env.vercel`
 * are never opened, and it prints matching lines, which are source text, never
 * a value from an environment file.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// Built from its code point so this file can be scanned by its own rule.
const EM_DASH = String.fromCodePoint(0x2014)

/** Text this repository authors. Anything else is binary or not ours. */
const EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.md',
  '.json',
  '.sql',
  '.yaml',
  '.yml',
  '.txt',
  '.sh',
  '.example',
])

/**
 * Never descended into. `node_modules` and `dist` are not ours; `.git` holds
 * every past version of everything, including text this rule postdates; and
 * `design/` holds photographic masters.
 */
const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-ssr',
  'coverage',
  '.vercel',
  'design',
  'public',
])

/**
 * Secret-bearing files, which this check must never open. `.env.example` is
 * committed and carries placeholders only, so it is scanned like any other
 * first-party text file.
 */
const SECRET_FILES = /^\.env(\..*)?$/

function isSecretFile(name) {
  return SECRET_FILES.test(name) && name !== '.env.example'
}

function* textFiles(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)

    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry)) {
        yield* textFiles(path)
      }
      continue
    }

    if (isSecretFile(entry)) {
      continue
    }

    if (EXTENSIONS.has(extname(entry)) || entry === '.gitignore') {
      yield path
    }
  }
}

const findings = []

for (const path of textFiles(ROOT)) {
  const contents = readFileSync(path, 'utf8')

  if (!contents.includes(EM_DASH)) {
    continue
  }

  contents.split('\n').forEach((line, index) => {
    if (line.includes(EM_DASH)) {
      findings.push({ file: relative(ROOT, path), line: index + 1, text: line })
    }
  })
}

if (findings.length > 0) {
  console.error(
    `✗ ${findings.length} em dash(es) (U+2014) found in first-party text.\n`,
  )

  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}`)
    console.error(`  ${finding.text.trim()}\n`)
  }

  console.error(
    'Rewrite the punctuation to fit the sentence. A period, comma, colon,\n' +
      'semicolon or a pair of parentheses will each be right somewhere; a\n' +
      'hyphen substituted mechanically will not.',
  )
  process.exit(1)
}

console.log('✓ no em dashes in first-party text')
