/*
 * Handing a generated backup to the browser.
 *
 * A Blob, an object URL, a synthetic click, and then the URL is revoked. No
 * server, no upload, no library: the file never leaves the device except by
 * the operator's own filesystem.
 *
 * What the browser cannot tell us is whether the operator kept the file, chose
 * a sensible location, or cancelled the save dialog. So the UI says "backup
 * file generated" and never "backup safely stored", and verification, where
 * the operator selects the file back off disk, is the step that provides real
 * evidence.
 */

export function downloadTextFile(
  fileName: string,
  contents: string,
  mimeType = 'application/octet-stream',
): void {
  const blob = new Blob([contents], { type: mimeType })
  const url = URL.createObjectURL(blob)

  try {
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
  } finally {
    // Revoked regardless: an un-revoked object URL keeps the whole backup,
    // participant records and all, alive in memory for the life of the page.
    URL.revokeObjectURL(url)
  }
}
