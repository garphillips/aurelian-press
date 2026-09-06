# The Shelf — a home screen in front of the books

*Plan written 6 Sept 2026. Reference point from Gareth: Meng To's "complete shelf" front page — a shelf of physical-looking books, each one opening into its own experience.*

## The idea
The site opens on a bookshelf, not on a plate. Two (later more) books stand on a wooden shelf in the same antique light as the plates: cloth or paper-covered boards, gilt-stamped spines, a little wear. Hovering pulls a book a few centimetres out of the row and tilts it toward you; clicking lifts it off the shelf, opens the cover, and the first plate rises out of the book into the full-screen experience we have built. Closing the book (Esc, or the "shelf" link in the masthead) reverses the move. The shelf is the index, the colophon and the front door in one.

## What's on the shelf, v1
| Book | Spine | Route | Status |
|---|---|---|---|
| Lucas, *Histoire naturelle des lépidoptères exotiques*, Paris 1835–36 | tall octavo, dark green cloth, gilt title | `/lucas/` | content-complete |
| Morris, *A History of British Moths*, London 1903, vol. 1 | quarto, red cloth, gilt moth on spine | `/british-moths/` | vol. 1 cut and named; vols 2–4 to follow as further volumes on the same shelf |
| (empty slots) | a gap or two, and a card that reads "more books to come" | | |

Each book carries a small label card on the shelf edge: title, author, year, plate count, "80 plates · 193 butterflies".

## How it works

**One app, several books.** Merge the two Vite sites into one codebase with a `books/` config: each book is a folder of content (`plates.json`, `plates/`, `content/`) plus a `book.json` (title, author, year, spine design, cover image, plate count, motion defaults). The shelf reads `books/index.json`; the plate experience is the existing code parameterised by book. Routes: `/` shelf, `/lucas/`, `/lucas/#n146` deep links unchanged, `/british-moths/`. The fork's site becomes a second book folder; nothing about the rigs or cards changes.

**Rendering the books.** Same Three.js scene as the plates, so the transition is continuous:
- A book is a box with five textured faces (front board, back board, spine, top and fore-edge as page-block textures). Boards get a cloth normal map; spine text is rendered to a canvas texture in IM Fell English and stamped gold with a slight emboss.
- Shelf: a plank with grain texture and a soft contact shadow under each book, lit by the same directional light as the plates so the books sit in the same room.
- Hover: book translates out 3 cm and rotates 12° on Y; label card fades in.
- Click: camera dollies in as the book lifts, rotates to face the viewer, the front board opens on a hinge (a second box pivoting at the spine), and the first plate's paper fades up to fill the screen. Then the plate scene takes over at plate 1. About 1.4 s; reduced motion gets a cut.
- Mobile: books stand in a single vertical column; tap opens.

**Cover art from the books themselves.** Both title pages exist in the scans:
- Lucas: the IA copy `bp_4916219-14` has the letterpress title page; we already have its OCR text, and the page image is one download away. Use the actual title page as the front-board paste-down label, sepia-graded.
- Morris: leaf 8 of `historyofbritish01morr_1` is the title page; leaf 7 is the frontispiece plate (Plate I, already downloaded as `n007.jpg`), which can appear as the "opened" first page.
Spines are designed, not scanned: title, author, volume, in gilt on the cloth colour of each book's period binding.

**Fallback and SEO.** The shelf is also a plain HTML list (each book a link with title and blurb) beneath the canvas, so the page reads without WebGL and search engines see the two books.

## Build order
1. **Config and routing (half a day).** Move both sites into one app with `books/` folders; make the plate experience take a book id; confirm both books still run and deep links hold.
2. **Shelf scene (1 day).** Plank, two book boxes, hover, label cards. Static covers first (flat colour + text).
3. **Open transition (1 day).** Lift, hinge, plate fade; reverse on close; reduced-motion cut.
4. **Cover assets (half a day).** Pull the two title pages, grade them, build spine textures.
5. **Polish (half a day).** Empty slots, mobile column, keyboard focus, colophon link.

## Decisions (Gareth, 6 Sept 2026)
- **Morris is four distinct books** on the shelf, vols 1–4 side by side, each opening into its own volume. The shelf config therefore needs a `series` field so the four spines read as a set (same cloth, same gilt, "Vol. I" to "Vol. IV").
- **Morris cover: use the real binding.** The 1903 Nimmo edition has a beautiful cover and it should be reproduced. Asset step: photograph or source a good image of the actual boards and spine (Gareth to supply or we hunt for a bookseller/library photo), then build the box textures from it.
- **Lucas cover: designed, with Gareth's hand.** No suitable original binding to copy (French 1830s part-works were issued in paper wrappers and bound to taste). Gareth will bring creative direction for a fitting cover; the plan is to design it together — starting points: a quarter-leather board with a paper label, the title page as the paste-down, a single engraved butterfly stamped on the front.

## Still open
- Whether the shelf shows progress ("193 of 193 named") or stays purely a bookshelf.
