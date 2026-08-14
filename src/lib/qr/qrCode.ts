import QRCode from 'qrcode'

/*
 * QR rendering.
 *
 * The `qrcode` package does the encoding, matrix generation, versioning, mask
 * selection, and this module turns the resulting matrix into SVG itself.
 *
 * Why not `QRCode.toString(..., { type: 'svg' })`:
 *
 *   Its output draws every dark module as part of ONE stroked path:
 *
 *     <path stroke="#000000" d="M4 4.5h7m5 0h1m1 0h6..."/>
 *
 *   Horizontal line segments on half-module y-coordinates, with no
 *   `stroke-width` attribute at all; each module's thickness is the SVG
 *   default of 1 user unit, centred on the line. Since the symbol carries a
 *   viewBox and no intrinsic size, one user unit maps to a different number of
 *   device pixels depending on the matrix size, so the hairline is rasterised
 *   differently for a 41x41 symbol than for a 45x45 one. Chrome's print
 *   pipeline rounded a 45x45 symbol's strokes down to near-nothing, printing
 *   thin horizontal lines while a 41x41 symbol from the same code printed
 *   solid. It stayed technically scannable, which is worse than failing.
 *
 *   Filled geometry has no such dependency: a rectangle covers the area it
 *   says it covers at any scale, in any rasteriser, on screen or through a PDF.
 *
 * So: no strokes anywhere. Dark modules are filled rectangles, consecutive dark
 * modules in a row merged into one rectangle each. Output stays vector, and CSS
 * still sizes the finished symbol to 26 mm.
 *
 * Error correction level **M** (~15%). Measured against the real payload
 * (109 bytes) at the 26 mm printed size:
 *
 *   L -> version 5, 37 modules, 0.58 mm each
 *   M -> version 6, 41 modules, 0.53 mm each   <- chosen
 *   Q -> version 8, 49 modules, 0.46 mm each
 *   H -> version 10, 57 modules, 0.40 mm each
 *
 * Higher correction means more modules in the same 26 mm, so each module gets
 * smaller and the code gets *harder* to scan: at 203 dpi, H would give barely
 * 3 printer dots per module against M's 4.2. The usual reason to accept that
 * trade is damage tolerance, but this system already has a designed answer for
 * a QR too damaged to read: the public code printed underneath it, which staff
 * types instead.
 */

/** Error correction level. See the note above before changing it. */
export const QR_ERROR_CORRECTION_LEVEL = 'M'

/**
 * Quiet zone in modules. Four is the specification minimum; scanners rely on
 * it to find the symbol, so it is never trimmed to save label space.
 */
export const QR_QUIET_ZONE_MODULES = 4

export const QR_DARK_COLOR = '#000000'
export const QR_LIGHT_COLOR = '#ffffff'

export interface QrSymbol {
  /** Modules per side, excluding the quiet zone (e.g. 41 for version 6). */
  readonly size: number
  /** Modules per side including the quiet zone on both sides. */
  readonly totalSize: number
  readonly version: number
  /** Standalone SVG markup, sized by CSS at the point of use. */
  readonly svg: string
}

/** One horizontal run of dark modules. */
interface Run {
  readonly row: number
  readonly start: number
  readonly length: number
}

/**
 * Finds maximal horizontal runs of dark modules, row by row.
 *
 * Merging runs keeps the node count down without changing the geometry: a run
 * of five dark modules is exactly one 5x1 rectangle.
 */
function darkRuns(size: number, data: Uint8Array): Run[] {
  const runs: Run[] = []

  for (let row = 0; row < size; row += 1) {
    let start = -1

    // One column past the end closes a run that reaches the right edge.
    for (let col = 0; col <= size; col += 1) {
      const dark = col < size && data[row * size + col] === 1

      if (dark && start === -1) {
        start = col
      } else if (!dark && start !== -1) {
        runs.push({ row, start, length: col - start })
        start = -1
      }
    }
  }

  return runs
}

/**
 * Encodes a payload and renders it as SVG.
 *
 * @param payload the exact string to encode; callers pass the serialised QR
 *   payload contract, never a record or anything with PII in it
 */
export function createQrSymbol(payload: string): QrSymbol {
  const qr = QRCode.create(payload, {
    errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL,
  })

  const { size, data } = qr.modules
  const quiet = QR_QUIET_ZONE_MODULES
  const totalSize = size + quiet * 2

  const modules = darkRuns(size, data)
    .map(
      (run) =>
        `<rect x="${run.start + quiet}" y="${run.row + quiet}" width="${run.length}" height="1" fill="${QR_DARK_COLOR}"/>`,
    )
    .join('')

  /*
   * No width/height attributes: the symbol is sized by CSS to 26 mm. The
   * viewBox is a fixed square derived from the matrix, so the aspect ratio
   * cannot drift whatever the CSS box turns out to be.
   */
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}"` +
    ` shape-rendering="crispEdges" role="img">` +
    `<rect x="0" y="0" width="${totalSize}" height="${totalSize}" fill="${QR_LIGHT_COLOR}"/>` +
    modules +
    `</svg>`

  return { size, totalSize, version: qr.version, svg }
}

/** The SVG for a payload. Deterministic: same payload, same markup. */
export function renderQrSvg(payload: string): string {
  return createQrSymbol(payload).svg
}
