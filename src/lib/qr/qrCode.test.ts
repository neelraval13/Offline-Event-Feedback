import { describe, expect, it } from 'vitest'
import {
  createQrSymbol,
  QR_DARK_COLOR,
  QR_ERROR_CORRECTION_LEVEL,
  QR_LIGHT_COLOR,
  QR_QUIET_ZONE_MODULES,
  renderQrSvg,
} from './qrCode'
import {
  buildQrPayload,
  parseQrPayload,
  serializeQrPayload,
} from '../identity/qrPayload'
import { formatPublicCode } from '../identity/publicCode'
import { deriveIssuerCode } from '../identity/issuerCode'
import { newParticipantId } from '../identity/uuid'
import { deviceId, eventId, participantId, stationId } from '../../types'
import { EVENT_CONFIG } from '../../config/event'

const EVENT = eventId('evt-dev-001')
const ISSUER = {
  stationId: stationId('A1'),
  issuerCode: deriveIssuerCode(deviceId('11111111-2222-4333-8444-555555555555')),
}

/** A payload of exactly the shape Point A prints. */
function contractPayload(): string {
  return serializeQrPayload(
    buildQrPayload({
      eventId: EVENT,
      participantId: newParticipantId(),
      publicCode: formatPublicCode(ISSUER, 1),
    }),
  )
}

/*
 * Payload lengths chosen to land on specific QR versions at EC level M.
 * The printed payload is 41x41 today, but its size depends on its content:
 * the encoder packs digits and uppercase far denser than arbitrary bytes, so
 * a longer event ID or public code would push it to 45x45. That is exactly the
 * transition that broke printing, so both are pinned here.
 */
const MATRIX_CASES = [
  { label: '21x21 (version 1)', payload: 'x'.repeat(5), size: 21, version: 1 },
  { label: '37x37 (version 5)', payload: 'x'.repeat(63), size: 37, version: 5 },
  { label: '41x41 (version 6)', payload: 'x'.repeat(85), size: 41, version: 6 },
  { label: '45x45 (version 7)', payload: 'x'.repeat(107), size: 45, version: 7 },
  { label: '49x49 (version 8)', payload: 'x'.repeat(123), size: 49, version: 8 },
] as const

describe('QR geometry is filled, never stroked', () => {
  /*
   * The Phase 2 QA defect: the previous renderer drew dark modules as one
   * stroked path with no stroke-width, so module thickness was an implicit
   * 1-user-unit hairline. Chrome's print pipeline rasterised that differently
   * once the matrix size changed, printing a 45x45 symbol as thin lines.
   */
  it.each(MATRIX_CASES)('uses no stroke at all for $label', ({ payload }) => {
    const svg = renderQrSvg(payload)

    expect(svg).not.toContain('stroke')
    expect(svg).not.toContain('stroke-width')
    expect(svg).not.toMatch(/<path/)
  })

  it.each(MATRIX_CASES)('draws dark modules as filled rects for $label', ({ payload }) => {
    const svg = renderQrSvg(payload)
    const rects = svg.match(/<rect[^>]*\/>/g) ?? []

    // Background plus at least one run of dark modules.
    expect(rects.length).toBeGreaterThan(1)
    for (const rect of rects) {
      expect(rect).toContain('fill=')
      expect(rect).not.toContain('stroke')
    }

    const darkRects = rects.filter((rect) => rect.includes(QR_DARK_COLOR))
    expect(darkRects.length).toBeGreaterThan(10)
  })

  it('paints a white background rather than relying on the page', () => {
    const svg = renderQrSvg(contractPayload())
    expect(svg).toContain(`fill="${QR_LIGHT_COLOR}"`)
  })

  it('keeps module edges crisp', () => {
    expect(renderQrSvg(contractPayload())).toContain(
      'shape-rendering="crispEdges"',
    )
  })

  it('has integer module geometry, so nothing lands on a half pixel', () => {
    // The old renderer placed lines on y+0.5 and leaned on stroke centring.
    const svg = renderQrSvg(contractPayload())
    const coordinates = svg.match(/(?:x|y|width|height)="([^"]+)"/g) ?? []

    expect(coordinates.length).toBeGreaterThan(10)
    for (const coordinate of coordinates) {
      expect(coordinate).not.toContain('.')
    }
  })
})

describe('matrix sizing and quiet zone', () => {
  it.each(MATRIX_CASES)(
    'produces $label with a four-module quiet zone',
    ({ payload, size, version }) => {
      const symbol = createQrSymbol(payload)

      expect(symbol.size).toBe(size)
      expect(symbol.version).toBe(version)
      expect(symbol.totalSize).toBe(size + QR_QUIET_ZONE_MODULES * 2)
      expect(symbol.svg).toContain(
        `viewBox="0 0 ${symbol.totalSize} ${symbol.totalSize}"`,
      )
    },
  )

  it.each(MATRIX_CASES)('leaves $label quiet zone free of dark modules', ({ payload }) => {
    const symbol = createQrSymbol(payload)
    const quiet = QR_QUIET_ZONE_MODULES
    const limit = quiet + symbol.size

    const darkRects = [...symbol.svg.matchAll(
      /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="#000000"\/>/g,
    )]
    expect(darkRects.length).toBeGreaterThan(0)

    for (const [, x, y, width] of darkRects) {
      const left = Number(x)
      const top = Number(y)
      expect(left).toBeGreaterThanOrEqual(quiet)
      expect(top).toBeGreaterThanOrEqual(quiet)
      expect(left + Number(width)).toBeLessThanOrEqual(limit)
    }
  })

  it('keeps a square viewBox so the aspect ratio cannot drift', () => {
    for (const { payload } of MATRIX_CASES) {
      const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(renderQrSvg(payload))
      expect(viewBox?.[1]).toBe(viewBox?.[2])
    }
  })

  it('carries no intrinsic size, leaving CSS to set 26mm', () => {
    const svg = renderQrSvg(contractPayload())
    expect(svg).not.toMatch(/<svg[^>]*\swidth=/)
    expect(svg).not.toMatch(/<svg[^>]*\sheight=/)
  })
})

describe('determinism', () => {
  it.each(MATRIX_CASES)('renders $label identically every time', ({ payload }) => {
    expect(renderQrSvg(payload)).toBe(renderQrSvg(payload))
  })

  it('renders the same identity identically across reprints', () => {
    const payload = contractPayload()
    const first = renderQrSvg(payload)

    for (let i = 0; i < 5; i += 1) {
      expect(renderQrSvg(payload)).toBe(first)
    }
  })

  it('encodes different payloads differently', () => {
    expect(renderQrSvg('one')).not.toBe(renderQrSvg('two'))
  })
})

describe('the identity contract survives rendering', () => {
  it('round-trips a printed payload back through the parser', () => {
    const participantId = newParticipantId()
    const publicCode = formatPublicCode(ISSUER, 1)
    const payload = serializeQrPayload(
      buildQrPayload({ eventId: EVENT, participantId, publicCode }),
    )

    // What gets encoded is exactly what Point B will later have to parse.
    const parsed = parseQrPayload(payload, {
      expectedEventId: EVENT,
      expectedStation: 'A1',
    })

    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.payload.participant).toBe(participantId)
    expect(parsed.ok && parsed.payload.code).toBe(publicCode)
    expect(parsed.ok && parsed.payload.v).toBe(1)

    // And it renders at one of the two sizes production actually produces.
    expect([41, 45]).toContain(createQrSymbol(payload).size)
  })

  it('renders both matrix sizes that real participants produce', () => {
    /*
     * This is the defect's actual trigger, and it is not an edge case: the
     * participant ID is a random UUIDv7, and the encoder packs digit-heavy
     * UUIDs into numeric segments while letter-heavy ones fall back to byte
     * mode. Measured over 3,000 real payloads, ~14% land on 41x41 and ~86% on
     * 45x45. Consecutive participants therefore get different matrix sizes at
     * random, which is why one sticker printed correctly and the next did not.
     */
    const sizes = new Set<number>()
    for (let i = 0; i < 400; i += 1) {
      sizes.add(createQrSymbol(contractPayload()).size)
    }

    expect(sizes).toEqual(new Set([41, 45]))

    // Both must render as filled geometry. Neither may stroke.
    for (let i = 0; i < 200; i += 1) {
      expect(renderQrSvg(contractPayload())).not.toContain('stroke')
    }
  })

  it('still renders once the payload grows past the 41x41 boundary', () => {
    // A longer event ID pushes the symbol to the next version. It must print,
    // not degrade; that is the whole point of this fix.
    const payload = serializeQrPayload(
      buildQrPayload({
        eventId: eventId('evt-a-considerably-longer-event-identifier-2026'),
        participantId: newParticipantId(),
        publicCode: formatPublicCode(ISSUER, 1),
      }),
    )

    const symbol = createQrSymbol(payload)
    expect(symbol.size).toBeGreaterThan(41)
    expect(symbol.svg).not.toContain('stroke')
  })

  it('prints the configured event at a known, pinned density', () => {
    /*
     * The event ID is encoded verbatim into every sticker, so its length has a
     * printed cost. With `ff-rc-2026-08-23` the payload is 114 bytes and the
     * symbol is version 7: 45 modules, 0.49 mm each inside 26 mm counting the
     * quiet zone, about 3.9 printer dots each at 203 dpi. That is a size Point B
     * has been physically tested against.
     *
     * Pinned here rather than left to be discovered on a print run. If this
     * fails, the payload changed size and the sticker got denser or sparser than
     * the one that was last scanned by hand.
     *
     * The participant ID is fixed rather than generated: the encoder packs
     * digit-heavy UUIDs into numeric segments, so about one in two thousand
     * random UUIDs compresses far enough to fit version 6. A random ID here
     * would make this test fail once in a very long while, for no defect.
     */
    const payload = serializeQrPayload(
      buildQrPayload({
        eventId: EVENT_CONFIG.eventId,
        participantId: participantId('019ffc65-4559-7125-9453-e230415644f1'),
        publicCode: formatPublicCode(ISSUER, 1),
      }),
    )

    expect(payload.length).toBe(114)
    // Under the 124-byte boundary where the symbol grows to 49 modules.
    expect(payload.length).toBeLessThan(124)

    const symbol = createQrSymbol(payload)
    expect(symbol.size).toBe(45)
    expect(symbol.version).toBe(7)
    // Whatever the density, it must still be filled geometry, never strokes.
    expect(symbol.svg).not.toContain('stroke')
  })

  it('would grow the symbol if the event ID spelled the venue out', () => {
    /*
     * The measurement behind keeping the ID short. Not a rule about this build
     * so much as a demonstration of the cost, so the next person to lengthen an
     * event ID sees what it does to the label.
     */
    const spelledOut = serializeQrPayload(
      buildQrPayload({
        eventId: eventId('flying-flea-richardson-cruddas-2026-08-23'),
        participantId: participantId('019ffc65-4559-7125-9453-e230415644f1'),
        publicCode: formatPublicCode(ISSUER, 1),
      }),
    )

    expect(spelledOut.length).toBe(139)
    expect(createQrSymbol(spelledOut).size).toBe(49)
  })

  it('uses error correction level M', () => {
    expect(QR_ERROR_CORRECTION_LEVEL).toBe('M')
  })

  it('rejects a payload too large to encode', () => {
    expect(() => renderQrSvg('x'.repeat(10_000))).toThrow()
  })
})
