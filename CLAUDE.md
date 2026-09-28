# The Aurelian Press

Antique natural-history books brought to life. Scroll through a real book plate by plate; each hand-coloured
engraving is cut into layers (body, wing-L, wing-R) and rigged to flutter in WebGL; click a specimen to pin it and
read a card. Live at https://aurelianpress.co.uk (Cloudflare Pages project `lepidoptera-plates`, also
https://lepidoptera-plates.pages.dev).

Three books on the shelf, oldest first:

| id | Book | Source | Plates / specimens |
|---|---|---|---|
| `lucas` | H. Lucas, *Histoire naturelle des lépidoptères exotiques*, Paris 1835–36 | BHL item 213697 | 80 / 193 |
| `british-butterflies` | F. O. Morris, *A History of British Butterflies*, London 1890 | IA `historyofbritish03morr` | 72 / 290 (caterpillars and chrysalides hidden) |
| `british-moths` | F. O. Morris, *A History of British Moths*, London 1903, four volumes | IA `01morr_1` … `04morr_0` | 132 / 1939 |

## Run it

```bash
cd site && npm install && npm run dev      # http://localhost:5199 (strict port)
npm run build                              # prerender-meta.mjs → tsc → vite build → site/dist
npm run deploy                             # build + wrangler pages deploy (needs `npx wrangler login` once)
```

Node 20, no framework: Vite + TypeScript + vanilla Three.js 0.160. Do not reintroduce React. Python 3.9 with
numpy + Pillow only (no scipy/cv2) for the cutter and content scripts. `.claude/launch.json` has a `site` entry
for the Browser pane.

## Layout

```
site/                     the one Vite app (all three books)
  index.html              single SPA shell; routes are pathnames: /, /lucas/, /british-butterflies/, /british-moths/
  src/main.ts             router + paper curtain          src/shelf.ts, bindings.ts   the shelf and the book bindings
  src/book.ts             reading session (scroll, ruler) src/plate.ts, specimen.ts  plate mounting and the rig
  src/card.ts             the pinned card                 src/shaders.ts             ink-multiply print shading
  scripts/prerender-meta.mjs   per-book HTML shells + sitemap/robots at build time (output is git-ignored)
  public/books/index.json      SHELF CONFIG: title, author, binding, spine type, status, hideRoles, volumes
  public/books/<id>/plates/    cut specimens (WebP layers + manifest per plate)
  public/books/<id>/content/plates.json   card content per specimen
  public/covers/<id>/          board photos, gilt masks, grain tiles for the bindings
  public/og/, public/icons/    share images and favicons
  public/embed/                self-contained single-specimen pages (scripts/build_embed.py, build_card.py)
  public/made/                 the "how it's made" series index and part I (static; built by scripts/made/)
  made/the-shelf-and-the-opening/   part II: a Vite entry of its own, src/made/shelf-page.ts renders the real
                               ShelfBook/bindings/Scene into one canvas scissored per figure; shared CSS in src/made/made.css
  public/_redirects            SPA fallback only
scripts/                  the LUCAS pipeline (Python); the Morris pipelines live in sibling repos, see below
  made/                   the "how it's made" pages: build_part1.py runs the real cutter on plate n100 and fills
                          how-a-book-is-cut.html into site/public/made/; build_part2_og.py draws part II's share image
content/                  Lucas content sources (captions, entries, species facts, translations, overrides)
assets-src/               Lucas scans (book/), author sketches, board photos, OCR text; ~74 MB, committed
mvp/, PLAN.md, PLAN-shelf.md   early trials and the original plans — historical, not current truth
```

## The two pipelines

**Lucas** (this repo), in order — anything keyed by specimen id must run after `apply_captions.py`:

1. `scripts/cut_book.py [plateKey…]` — scans → ink alpha → components → body/wing split → WebP layers + manifest
   into `site/public/books/lucas/plates/`. Per-plate fixes in `content/plate-overrides.json`.
2. `scripts/apply_captions.py` — re-key entries by the handwritten plate captions (`content/captions.json`).
3. `scripts/enrich_lucas.py` — GBIF/Wikipedia/Wikidata → `content/species-auto.json`
   (manual identifications in `content/taxonomy-overrides.json`; HTTP cache in `assets-src/text/cache/`, ignored).
4. `scripts/build_content.py` — merges entries, auto data, translations and hand-written `content/species.json`
   (highest priority) → `site/public/books/lucas/content/plates.json`.

**Morris** (Moths and Butterflies) run from sibling repos `../british-moths` and `../british-butterflies`
(github.com/garphillips/british-moths and /british-butterflies — clone them beside this one), which mirror this
layout with a `VOL=<n>` env var (see their `scripts/vol.py`). Their output `out/v<n>/{plates,content}`
is **copied** into `site/public/books/british-moths/<n>/` and `site/public/books/british-butterflies/`; after a
re-cut, rsync it back in and commit. (They used to be symlinks; copies keep this repo cloneable on its own.)

## Things a new session should know

- **Hidden specimens.** Badly cut specimens are hidden, not re-cut: `cut_metrics.py` in the Morris repos writes
  `hidden.json`, `build_content` marks `hidden: true`, and the site leaves them off the page. Plates with nothing
  visible are skipped and numerals come from content order. Hand corrections go in `hidden-overrides.json`.
  **Do not re-cut a book without Gareth's say-so** — the pale-wing cutter fix (`PALE=1` in the Morris
  `cut_book.py`) is trialled but not rolled out.
- **Judge pale specimens at ≥300 px renders**, not thumbnails — holes vanish at 150 px.
- **Taste.** Flutter is calm and slow (amp 0.38, freq 1.1, lag 0.85). Fonts IM Fell English + EB Garamond; ink
  multiplied onto paper; hand-coloured by default with an ink-only toggle. Scroll snapping is `y proximity`, no
  scroll hacks. Morris is one book on the shelf with volumes navigated inside it. Books float in one column,
  lying on their backs, spine to the viewer. One spine typeface per book (Lucas Playfair italic, Moths Libre
  Baskerville, Butterflies Cinzel). No sepia filters on the author sketches.
- **Cards stay honest.** Unsettled identities say so; ~36 Lucas names are still open. Latin on Morris cards is
  often the 1890/1903 name when GBIF found no accepted one.
- **Build size.** ~13k files, ~120 MB. Cloudflare Pages caps at 20,000 files / 25 MiB per file, so a fourth book
  needs fewer files per specimen (atlas) or R2.
- **Deploy.** Production is the `main` branch deployed by `npm run deploy` from a logged-in wrangler. The
  aurelianpress.co.uk DNS and the www→apex redirect are zone rules in the Cloudflare dashboard, not in this repo.
