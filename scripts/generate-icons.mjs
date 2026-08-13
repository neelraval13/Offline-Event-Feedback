/*
 * Generates the temporary PWA icons.
 *
 * These are placeholders: a flat blue tile with a plain "EF" mark. There is no
 * final branding yet, and none is being invented here. Replacing them later is
 * a matter of dropping new PNGs into `public/icons/` — nothing in the
 * application architecture depends on what they look like.
 *
 * Written as a script rather than committed-and-forgotten binaries so the
 * placeholders stay reproducible and obviously temporary. It has no
 * dependencies and touches no network: a small PNG encoder over `node:zlib`.
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUTPUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'icons',
)

/** Matches --accent in src/styles.css, so the icon is not a new palette. */
const ACCENT = [0x1a, 0x56, 0xb8]
const WHITE = [0xff, 0xff, 0xff]

function crc32(bytes) {
  let crc = 0xffffffff

  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }

  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)

  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))

  return Buffer.concat([length, typed, crc])
}

/** Encodes RGB pixel rows as a PNG. */
function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: truecolour
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlace

  // One filter byte (0 = None) per scanline, then RGB triples.
  const stride = width * 3
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Draws "EF" as filled rectangles on a solid tile.
 *
 * `safeFraction` keeps the mark inside the maskable safe zone: a maskable icon
 * may be cropped to a circle, so the glyphs occupy the middle 60% rather than
 * running to the edges.
 */
function drawIcon(size, safeFraction) {
  const pixels = Buffer.alloc(size * size * 3)

  for (let i = 0; i < size * size; i += 1) {
    pixels[i * 3] = ACCENT[0]
    pixels[i * 3 + 1] = ACCENT[1]
    pixels[i * 3 + 2] = ACCENT[2]
  }

  const fill = (x0, y0, x1, y1) => {
    for (let y = Math.round(y0); y < Math.round(y1); y += 1) {
      for (let x = Math.round(x0); x < Math.round(x1); x += 1) {
        if (x < 0 || y < 0 || x >= size || y >= size) {
          continue
        }
        const offset = (y * size + x) * 3
        pixels[offset] = WHITE[0]
        pixels[offset + 1] = WHITE[1]
        pixels[offset + 2] = WHITE[2]
      }
    }
  }

  // Two letterforms side by side inside the safe area.
  const safe = size * safeFraction
  const top = (size - safe) / 2
  const left = (size - safe) / 2
  const letterWidth = safe * 0.42
  const gap = safe * 0.16
  const stroke = safe * 0.17

  const letter = (x, arms) => {
    fill(x, top, x + stroke, top + safe) // upright
    for (const arm of arms) {
      fill(x, top + safe * arm, x + letterWidth, top + safe * arm + stroke)
    }
  }

  // E: three arms. F: two.
  letter(left, [0, 0.415, 1 - stroke / safe])
  letter(left + letterWidth + gap, [0, 0.415])

  return encodePng(size, size, pixels)
}

mkdirSync(OUTPUT_DIR, { recursive: true })

const ICONS = [
  { file: 'icon-192.png', size: 192, safe: 0.72 },
  { file: 'icon-512.png', size: 512, safe: 0.72 },
  // Maskable icons are cropped to the platform's mask, so the mark sits well
  // inside the 80% safe zone recommended for them.
  { file: 'icon-maskable-512.png', size: 512, safe: 0.52 },
]

for (const icon of ICONS) {
  const png = drawIcon(icon.size, icon.safe)
  writeFileSync(join(OUTPUT_DIR, icon.file), png)
  console.log(`${icon.file}  ${icon.size}x${icon.size}  ${png.length} bytes`)
}
