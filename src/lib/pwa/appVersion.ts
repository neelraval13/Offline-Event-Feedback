/*
 * Build identity.
 *
 * Both values are injected at build time (see `define` in vite.config.ts), so
 * answering "what version is this device running?" needs no network, no server
 * and no repository access — an operator reads it off Admin and compares it
 * with the terminal next to it.
 *
 * Deliberately just a version and a timestamp. No commit hash, no branch, and
 * nothing identifying the machine that produced the build.
 */

/** The `version` field from package.json at build time. */
export const APP_VERSION: string = __APP_VERSION__

/** ISO timestamp of the build, to the second. */
export const BUILD_ID: string = __BUILD_ID__

/** One line for the Admin screen. */
export function describeAppVersion(): string {
  return `${APP_VERSION} · ${BUILD_ID}`
}
