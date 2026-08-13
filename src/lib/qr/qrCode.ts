import QRCode from 'qrcode'

/*
 * QR rendering.
 *
 * The `qrcode` package, bundled with the application. Nothing here contacts a
 * service: a QR image fetched from a URL would put participant identifiers on
 * someone else's network and would fail at an event with no connectivity.
 *
 * Output is **SVG**, not a raster. A sticker is a print artefact, and vector
 * modules land on exact device pixels at whatever DPI the label printer runs,
 * with no resampling blur along module edges — which is the failure that makes
 * small QR codes unscannable. It also keeps the printed size a pure CSS
 * concern.
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
 * smaller and the code gets *harder* to scan — at 203 dpi, H would give barely
 * 3 printer dots per module against M's 4.2. The usual reason to accept that
 * trade is damage tolerance, but this system already has a designed answer for
 * a QR too damaged to read: the public code printed underneath it, which staff
 * types instead. Spending module size on redundancy we have a better fallback
 * for would be the wrong way round.
 */

/** Error correction level. See the note above before changing it. */
export const QR_ERROR_CORRECTION_LEVEL = 'M'

/**
 * Quiet zone in modules. Four is the specification minimum; scanners rely on
 * it to find the symbol, so it is never trimmed to save label space.
 */
export const QR_QUIET_ZONE_MODULES = 4

/**
 * Renders a payload string as a standalone SVG document.
 *
 * @param payload the exact string to encode — callers pass the serialised QR
 *   payload contract, never a record or anything with PII in it
 * @returns SVG markup, sized by CSS at the point of use
 */
export async function renderQrSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, {
    type: 'svg',
    errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL,
    margin: QR_QUIET_ZONE_MODULES,
    color: {
      // Black modules on white. No logo, no tint: both cost scan reliability
      // and neither buys anything at this size.
      dark: '#000000ff',
      light: '#ffffffff',
    },
  })
}
