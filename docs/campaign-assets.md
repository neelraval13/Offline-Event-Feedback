# Campaign assets

Local files only. The reference implementation hot-links its fonts from Google
and its photography from Royal Enfield's CDN; this application must render both
at a venue with no Wi-Fi, so everything ships in the repository and is precached
with the shell.

## Photography — `public/assets/flying-flea/`

Declared in `src/features/campaign/flying-flea/assets.ts` as plain constants.
These files are part of the application: a build without them is broken, not
degraded, so nothing probes for their existence at runtime.

| File | Dimensions | Size | Renders |
| --- | --- | --- | --- |
| `bike-flea-green.webp` | 922 × 593, alpha | 122 KB | Point A, Step 02, when Flea Green is selected |
| `bike-storm-black.webp` | 940 × 593, alpha | 114 KB | Point A, Step 02, when Storm Black is selected |
| `registration-header.webp` | 2400 × 1274 | 229 KB | Banner on Point A and Point B |

Both motorcycles carry a real alpha channel, so they sit on the dark card with no
plate behind them. The preview stage is `aspect-ratio: 940 / 593` — matched to
the wider of the two — so switching colour cannot resize the frame, and
`object-fit: contain` keeps the whole motorcycle visible at every width.

### Masters

`design/assets/flying-flea/registration-header-master.webp` is the supplied
5913 × 3140 original (800 KB), kept out of the application. It is roughly 74 MB
of decoded image on a tablet, to fill a strip a few hundred pixels tall; the
shipped file is a 2400 px derivative. Regenerate it with:

```bash
magick design/assets/flying-flea/registration-header-master.webp \
  -resize 2400x -quality 82 -define webp:method=6 \
  public/assets/flying-flea/registration-header.webp
```

## Fonts — `public/fonts/`

| File | Role | Token |
| --- | --- | --- |
| `FlyingFlea-Bold.otf` | Campaign display: headings, plates, captions | `--ff-font-display` |
| `Graphik-Medium.otf` | Reading copy: prompts, hero sub-lines, notes | `--ff-font-body` |
| `Inter_18pt-Medium.ttf` | Interface: labels, controls, digits, tables | `--ff-font-ui` |
| `Inter_18pt-Bold.ttf` | The same, bold | `--ff-font-ui` |

`@font-face` rules are in `src/styles/fonts.css`; nothing else names a family.
`Inter-Medium.otf` from the supplied archive is deliberately not installed — it
duplicates the Medium role, and pairing it with the 18pt Bold would mix two
optical sizes in one interface.

The printed sticker deliberately uses a system and monospace stack. A label is
printed and scanned, and it must render identically whether or not a web font
loaded.

## Favicon — `public/`

`favicon.svg`, `favicon.png` (67 × 67) and `apple-touch-icon.png` (512 × 512),
taken from the campaign package's own `custom-domain/` assets and linked from
`index.html`. The PWA icon set under `public/icons/` is unchanged: campaign
install icons at the required sizes and maskable safe areas were not supplied.
