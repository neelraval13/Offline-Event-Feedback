import { describe, expect, it } from 'vitest'
import {
  QR_ERROR_CORRECTION_LEVEL,
  QR_QUIET_ZONE_MODULES,
  renderQrSvg,
} from './qrCode'

const SAMPLE_PAYLOAD = JSON.stringify({
  v: 1,
  event: 'evt-dev-001',
  participant: '0199f5c2-1a2b-7c3d-8e4f-0123456789ab',
  code: 'A1-B8EFD9-00001-X',
})

describe('renderQrSvg', () => {
  it('produces an SVG document', async () => {
    const svg = await renderQrSvg(SAMPLE_PAYLOAD)

    expect(svg).toContain('<svg')
    expect(svg).toContain('viewBox')
    expect(svg).toContain('</svg>')
  })

  it('is deterministic for the same payload', async () => {
    // A reprint must produce the identical symbol, not merely an equivalent one.
    expect(await renderQrSvg(SAMPLE_PAYLOAD)).toBe(
      await renderQrSvg(SAMPLE_PAYLOAD),
    )
  })

  it('encodes different payloads differently', async () => {
    expect(await renderQrSvg('one')).not.toBe(await renderQrSvg('two'))
  })

  it('keeps the standard four-module quiet zone', async () => {
    const svg = await renderQrSvg(SAMPLE_PAYLOAD)
    const viewBox = /viewBox="0 0 (\d+) \d+"/.exec(svg)
    expect(viewBox).not.toBeNull()

    // Version 6 at EC level M is 41 modules, plus 4 modules of quiet zone
    // on each side.
    expect(Number(viewBox?.[1])).toBe(41 + QR_QUIET_ZONE_MODULES * 2)
  })

  it('renders black modules on white', async () => {
    const svg = await renderQrSvg(SAMPLE_PAYLOAD)
    expect(svg.toLowerCase()).toContain('#000000')
    expect(svg.toLowerCase()).toContain('#ffffff')
  })

  it('uses error correction level M', () => {
    expect(QR_ERROR_CORRECTION_LEVEL).toBe('M')
  })

  it('rejects a payload too large to encode', async () => {
    await expect(renderQrSvg('x'.repeat(10_000))).rejects.toThrow()
  })
})
