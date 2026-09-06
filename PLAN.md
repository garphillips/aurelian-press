# The Lepidoptera Plates — Project Plan

> **Status (5 Sept 2026).** Building for real. The source is one book: *Histoire naturelle des lépidoptères exotiques* (Paris: Pauquet, 1835–36), 80 plates, ~192 specimens, public domain via the Biodiversity Heritage Library. The site is the book: scroll plate by plate in the printed order; every specimen is cut into layers and rigged; click to pin and read.
>
> **Stack as built:** Vite + TypeScript + vanilla Three.js in `site/` (dev: `npm run dev`, port 5199). React/Next.js from the original plan was dropped: the MVP proved the DOM layer is tiny and the WebGL scene is the whole site. Cutter: `scripts/cut_book.py` (numpy + Pillow), overrides in `content/plate-overrides.json`, textures in `site/public/plates/<plateKey>/`. Plate index: `content/book-plates.json`.
>
> **Done:** MVP trials (`mvp/`), automatic 2-wing cutter for all 80 plates, silhouette fill so white wings survive, two-pass print shading (multiply for pigment, additive for whites), scroll-by-plate camera, vertical ruler indicator, pin + card, deep links (`#n16`), ink-only toggle (`i`), lazy plate mounting.
>
> **Next:** transcribe the handwritten captions to name the ~188 unnamed specimens and write facts (`content/species.json`); hand-cut 4-wing rigs for favourites; scanned paper texture; sound; deploy (Vercel or Cloudflare Pages); git init.

The original plan follows, kept for the reasoning behind the design.

---

## 1. Experience design

### Core illusion
The drawings stay drawings. Nothing is redrawn or 3D-modelled. Each specimen is split into a handful of flat layers (body, wings) that hinge in real 3D around the body axis, with a soft bend along the wing so tips lag the roots. Lit from above, each casts a soft shadow onto the paper. The result reads as "the plate has come alive", not "a 3D butterfly".

### Structure (information architecture)
Think of it as a book with chapters, scrolled rather than paged.

1. **Cover / title page** — one hero specimen breathing slowly. Letterpress title, "turn the page" hint.
2. **Index (Contents)** — a grid of small plates ("Tab. I, II, III…"). Click jumps to that specimen. Doubles as site navigation.
3. **Chapters** (3–4 for v1, each with 3–5 specimens):
   - *I. Of the Day* — butterflies. Bright cream paper.
   - *II. Of the Night* — moths. Paper darkens, a lamplight vignette follows the cursor.
   - *III. Giants and Miniatures* — true-scale mode. Atlas moth vs. a Small Blue, with an inked ruler.
   - *(optional) IV. Metamorphosis* — egg, larva, pupa, adult as a sequence.
4. **Colophon** — sources, plate credits, typefaces, method. In the spirit of old books, and legally necessary for the public-domain scans.

### Interactions
| Moment | Behaviour |
|---|---|
| Idle | Every specimen breathes with its own rhythm. Moths beat slower and heavier than butterflies. Occasionally one flutters briefly then settles. |
| Cursor near | Specimen "startles": a quick half-beat and slight lift, then calms. Paper layers parallax gently with the mouse. |
| Scroll | Drives the camera through the chapter. Between chapters one or two specimens lift off and fly across the page on a noise-driven path, then land in the next chapter. |
| Click / tap ("pin") | Camera dollies in, wings settle flat to plate pose, a fact card slides in beside it. URL updates for deep linking. |
| Hotspots (pinned state) | Small inked numerals on wing parts (eyespot, antennae, proboscis). Hover reveals a one-line micro-fact. |
| Loupe | Hold to magnify. Rewards the detail in the engravings; this is why high-res assets matter. |
| True scale toggle | Rescales all specimens on the page to real wingspans, with a ruler. |
| Sound (opt-in) | Faint wing beat and paper rustle. Off by default. |
| Reduced motion | Wings hold still, transitions become fades. All content remains reachable. |

### Typography and ornament
- Titles and Latin names: **IM Fell English** (digitised from 17th-century Fell types; italic for binomials).
- Body and facts: **EB Garamond**.
- Optional handwritten annotations: one script face used sparingly (e.g. *Homemade Apple*), for "collected 1834"-style marginalia.
- Ornaments (borders, plate numerals, ruler, pin) as SVG in the DOM layer so they stay razor-sharp at any zoom.

---

## 2. Tech stack

### Recommendation
| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router), static export** | Per-species routes (`/plate/atlas-moth`) with real HTML fact content: shareable, indexable, and a no-WebGL fallback for free. Deploys to Vercel/Cloudflare Pages in one step. |
| Language | TypeScript | Content manifests and shader uniforms are typed. |
| 3D | **Three.js via @react-three/fiber** + **@react-three/drei** | The specimen rig (hinged, bending wing planes with shadows onto paper) is a WebGL job. R3F keeps it declarative and composable with React state. Drei gives texture loading, `Html` overlays, `PerformanceMonitor`, soft shadows. |
| Wing material | Custom `ShaderMaterial` | Vertex shader: rotate wing about the body axis by `amp·sin(t·freq+phase)`, scaled by `pow(distFromRoot, 1.5)` for bend; hindwing gets a small phase lag. Fragment shader: reads a single-channel ink-density texture and multiplies it onto the paper colour, so paper grain shows through the ink like a real print. |
| Shadows | Three shadow maps with `alphaTest` on wing materials, or drei `AccumulativeShadows` | Soft contact shadow on the paper is what sells "specimen hovering above the page". |
| Post | @react-three/postprocessing: `Noise` (film grain), `Vignette` | Restrained. No bloom, no chromatic aberration. |
| Scroll & camera | **Lenis** (smooth scroll) + **GSAP ScrollTrigger** | Scroll position → camera timeline. GSAP is free for all use since 2025. Also handles the pin/unpin camera moves. |
| DOM motion | **Motion for React** (Framer Motion) | Fact cards, index grid, hotspot reveals. |
| State | **zustand** | Frame-loop-friendly; R3F components read from the store without re-rendering React on every frame. |
| Content | JSON/MDX per species in `/content`, validated with **zod** | One file per specimen holds names, taxonomy, wingspan, facts, sources, and the rig manifest. |
| Dev tuning | **leva** | Live sliders for flap amplitude, frequency, bend, phase, shadow softness. Essential for getting the motion right by eye. |
| Noise | `simplex-noise` | Flight paths and idle variation. |
| Fonts | Google Fonts (IM Fell English, EB Garamond) or self-hosted woff2 | |
| Testing | Vitest (content schema, manifest checks), Playwright (smoke: page loads, WebGL fallback renders) | |
| Hosting | Vercel or Cloudflare Pages; textures on the same CDN with long cache headers | |

### Alternatives considered
- **Pure DOM/CSS** (`transform: rotateY` on wing `<div>`s under `perspective`). Surprisingly convincing for hinged wings and far simpler. Loses wing bend, real shadows, post grain, and struggles past ~6 large specimens. Good "lite" fallback or a quick proof of concept.
- **Rive** for 2D bone rigs with mesh deformation. Excellent wing bending and small files, but raster textures at 2K+ scale are a weak point, and it does not sit inside a WebGL scene with depth and shadows.
- **Sprite sheets / video** — heavy, non-interactive, no per-specimen variation. No.
- **Pixi.js** — fine for 2D, but we want true 3D hinging and shadows; Three is the better fit.
- **Astro + React island** — nice for content sites, but here the canvas *is* the site; Next.js is the simpler single mental model.

### Camera
Perspective camera with a narrow FOV (~22°). Keeps the flat-plate feel while giving depth cues for flight and shadows. Wings foreshorten convincingly as they hinge.

### Performance budget
- Target 60 fps on a 2020 MacBook Air; 30 fps on a mid-range phone.
- Clamp device pixel ratio to 1.5 on mobile, 2 on desktop.
- Texture tiers: 2048 px desktop, 1024 px mobile, chosen at load.
- Only chapter-visible specimens are mounted; others are unloaded via React Suspense boundaries.
- `PerformanceMonitor` from drei degrades shadow resolution and grain before dropping frames.
- Lazy-load chapters as scroll approaches.

### Accessibility and fallback
- All fact content lives in the DOM (server-rendered), not in the canvas.
- Keyboard: Tab moves between specimens, Enter pins, Esc unpins, arrows move between chapters.
- `prefers-reduced-motion` respected as above.
- No WebGL → static PNG plates with the same typography. Still a nice site.

---

## 3. Asset plan

### 3.1 Sourcing the drawings
Use **real public-domain engravings of real species** so the facts match the picture. Generated imagery is not recommended for specimens: anatomical accuracy is poor and it undermines the factual content. It is fine for decoration (ornaments, paper textures) if needed.

Primary sources (all high-res, free to use; confirm rights per plate):
- **Biodiversity Heritage Library** (biodiversitylibrary.org and their Flickr, 300k+ plates, mostly PD/CC0). Search by author.
- **Wikimedia Commons** categories for the authors below.
- **Smithsonian Open Access** (CC0), **Wellcome Collection**, **NYPL Digital Collections**, **Rijksmuseum**, **Internet Archive** book scans.
- **Natural History Museum London Data Portal** — CC BY photos of dorsal pinned specimens. Useful when no engraving exists for a species you want; can be graded to match the ink style, though scans of real engravings will always look more authentic.

Authors whose plates suit the style (dorsal, spread, finely hatched):
Moses Harris *The Aurelian* (1766); Edward Donovan *Natural History of British Insects* (1792–1813); Jacob Hübner; Dru Drury *Illustrations of Natural History*; Pieter Cramer *De uitlandsche Kapellen*; Adalbert Seitz *Macrolepidoptera of the World* (1906–, photographic-lithographic, very consistent); Maria Sibylla Merian (coloured, but grades beautifully to ink).

Selection criteria per plate:
- Dorsal view, wings fully spread, body vertical, minimal overlap between fore- and hindwing.
- Scan resolution ≥ 3000 px across the specimen (aim for the wingspan to be ≥ 2500 px).
- Clean paper, or foxing that can be levelled out.
- Species you can write good facts about.

Aim for **12–16 specimens** in v1. Keep a `sources.csv` from day one: species, source, plate number, artist, year, URL, licence.

### 3.2 Preparing each specimen
Tools: Photoshop, Affinity Photo, or Krita (free). Photoshop's generative fill helps with reconstructing hidden wing areas.

1. **Acquire** the highest-res scan. Note source details in the manifest.
2. **Grade to ink.** Desaturate, set a white point so the paper reads as pure white, curves to push hatching contrast. Apply the same grade preset to every plate so the collection looks like one book.
3. **Extract ink density, not a cut-out.** Because ink is dark on light paper, invert luminance into a single channel: `ink = 1 − luminance`. This preserves soft hatching edges and looks far better than a magic-wand mask. Mask out pins, labels, neighbouring specimens, and stray paper texture.
4. **Segment into parts** on separate layers:
   - `body` (head, thorax, abdomen, antennae, legs)
   - `wing-fore-L`, `wing-hind-L`, `wing-fore-R`, `wing-hind-R`
   - Where the forewing overlaps the hindwing, **paint in the hidden hindwing region** (clone/generative fill, a few minutes each) so nothing tears when the forewing lifts.
   - For moths with heavily overlapping wings, use a **2-wing rig** (one plane per side) instead. Decide per specimen; record `rig: "4-wing" | "2-wing"` in the manifest.
   - Mirroring one side to make the other halves the work, but authentic engravings are hand-drawn and slightly asymmetric. Prefer the real drawing; mirror only when a side is damaged.
5. **Mark pivots.** Each wing's hinge point sits on the body axis at the wing root. Record it in normalised specimen coordinates (0–1). A small dev "Specimen Inspector" page with leva controls lets you drag pivots visually and save to JSON, which is faster than measuring in Photoshop.
6. **Export parts** as tight-cropped 8-bit **grayscale PNG** (value = ink density). Export from the same canvas so each part's bounding box is known; a script writes bbox + pivot into the manifest.
7. **Keep the layered master** (`.psd` / `.afphoto` / `.kra`) in cloud storage or Git LFS, not in plain git.

### 3.3 File formats
| Asset | Master | Runtime | Notes |
|---|---|---|---|
| Specimen parts | Layered PSD/Affinity/Krita | **KTX2 (UASTC, zstd)** primary; **WebP** fallback | Single channel (R = ink density). 2048 px and 1024 px tiers. KTX2 cuts GPU memory ~4–6× vs. PNG/WebP and decodes off the main thread. Start with WebP for speed of iteration; add KTX2 in the performance phase. |
| Paper | 4096 px scan or CC0 texture (BHL blank endpapers are ideal) | JPG/WebP, tileable; plus 1–2 large non-tiling "hero" sheets with foxing | Optional normal map for fibre lighting under the moving shadow. |
| Ornaments, ruler, pin, numerals | Figma / Illustrator | **SVG** in DOM | Traced from PD sources or drawn. |
| Fonts | — | woff2 | IM Fell English, EB Garamond. |
| Content | MDX or JSON | JSON | zod-validated. |
| Manifest | JSON per specimen | JSON | See schema below. |
| Audio (optional) | WAV | short MP3/OGG loops | Off by default. |

### 3.4 Manifest schema (one per specimen)
```json
{
  "id": "atlas-moth",
  "names": { "common": "Atlas Moth", "latin": "Attacus atlas", "family": "Saturniidae" },
  "wingspanMm": 240,
  "rig": "4-wing",
  "canvas": { "w": 4096, "h": 3200 },
  "parts": {
    "body":        { "src": "body",   "bbox": [1900, 400, 2200, 2600] },
    "wing-fore-L": { "src": "fl",     "bbox": [0, 300, 2000, 1800],  "pivot": [0.49, 0.33], "phase": 0.0 },
    "wing-hind-L": { "src": "hl",     "bbox": [300, 1500, 2000, 3000], "pivot": [0.49, 0.45], "phase": 0.12 },
    "wing-fore-R": { "src": "fr",     "bbox": [2096, 300, 4096, 1800], "pivot": [0.51, 0.33], "phase": 0.0 },
    "wing-hind-R": { "src": "hr",     "bbox": [2096, 1500, 3800, 3000], "pivot": [0.51, 0.45], "phase": 0.12 }
  },
  "motion": { "freqHz": 0.6, "ampDeg": 35, "bend": 0.6, "restAmpDeg": 4 },
  "hotspots": [ { "part": "wing-fore-L", "uv": [0.7, 0.4], "label": "Snake-head wingtip", "fact": "…" } ],
  "facts": ["…", "…", "…"],
  "sources": [{ "plate": "Tab. XII", "work": "…", "author": "…", "year": 1820, "url": "…", "licence": "PD" }]
}
```

### 3.5 Asset build script
A Node script (`scripts/build-assets.ts`) using **sharp** that:
1. Reads each specimen's layer PNGs.
2. Computes tight bounding boxes and writes them into the manifest.
3. Emits 2048 and 1024 tiers as WebP (and KTX2 via `toktx` from KTX-Software when enabled).
4. Fails the build if any manifest is missing a pivot, source, or licence.

### 3.6 Content
Per species: common and Latin name, family, wingspan (drives true-scale mode), range, habitat, flight season, and 3–5 short "curiosity" facts written in the voice of a Victorian naturalist but factually checked. Cite sources (Butterfly Conservation, UKMoths, museum pages). Short is better: each fact one or two sentences.

---

## 4. Build phases

| Phase | Goal | Deliverable |
|---|---|---|
| **0. Prove the illusion** (first) | One specimen, the wing shader, a shadow on paper, leva sliders. This is the only real technical risk; do it before anything else. | A single page that makes people say "oh". |
| **1. Asset pipeline** | Prepare 3 specimens end to end. Build the manifest script and the Specimen Inspector dev page. | 3 rigged specimens loading from manifests. |
| **2. The book** | Cover, one chapter with scroll-driven camera, index page, routing. | Navigable skeleton. |
| **3. Facts & typography** | Pin interaction, fact cards, hotspots, deep links, colophon. | Content-complete for 3 specimens. |
| **4. Fill the atlas** | Remaining 9–13 specimens, all chapters, flight transitions, loupe, true-scale, sound. | Feature-complete. |
| **5. Polish & ship** | KTX2, mobile tiers, reduced motion, keyboard nav, WebGL fallback, Lighthouse pass. | Launch. |

Suggested repo layout:
```
/app                 Next.js routes (/, /plate/[id], /colophon)
/components/canvas   R3F scene, Specimen, Wing, Paper, Shadows, Camera
/components/ui       FactCard, Index, Ornaments, Loupe
/shaders             wing.vert.glsl, ink.frag.glsl
/content             one JSON/MDX per specimen
/public/assets       built textures (webp/ktx2), paper, svg
/assets-src          layer PNGs per specimen (LFS)
/scripts             build-assets.ts, inspector tooling
```

---

## 5. Key risks and how the plan handles them
- **Wing rig looks mechanical.** Mitigated by the bend term, per-wing phase lag, noise-driven variation, and leva tuning in Phase 0.
- **Segmenting overlapping wings is slow.** Allow 2-wing rigs for hard moths; budget ~45–90 minutes per specimen for a 4-wing rig.
- **Texture memory on mobile.** Single-channel ink textures, 1024 tier, KTX2, and mounting only visible specimens.
- **Rights.** Only PD/CC0 scans, tracked in `sources.csv`, credited in the colophon.
- **Facts drift from pictures.** Real drawings of real species, cited.
