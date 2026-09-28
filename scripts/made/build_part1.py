"""
How it's made, part I: site/public/made/how-a-book-is-cut/index.html, one self-contained page explaining how a
plate is cut and mounted, plus its share image site/public/og/made-how-a-book-is-cut.png.
Runs the real Lucas cutter functions on the n100 scan so every picture in the story is genuine.
    python3 scripts/made/build_part1.py
"""
import base64, io, json, os, sys
import numpy as np
from PIL import Image, ImageFilter, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, f'{ROOT}/scripts')
import cut_book as cb

KEY, SID = 'n100', 'n100-1'
PLATES = f'{ROOT}/site/public/books/lucas/plates/{KEY}'
scan_path = f'{ROOT}/assets-src/book/n100_50026359422.jpg'
manifest = json.load(open(f'{PLATES}/manifest.json'))
spec = manifest['specimens'][0]
content = json.load(open(f'{ROOT}/site/public/books/lucas/content/plates.json'))
card = content['specimens'][SID]

def b64(im, fmt='PNG', **kw):
    buf = io.BytesIO(); im.save(buf, fmt, **kw)
    mime = {'PNG': 'image/png', 'JPEG': 'image/jpeg', 'WEBP': 'image/webp'}[fmt]
    return f'data:{mime};base64,' + base64.b64encode(buf.getvalue()).decode()

im = Image.open(scan_path).convert('RGB')
W, H = im.size
arr = np.asarray(im).astype(np.float32) / 255
alpha, paper = cb.ink_alpha(arr)

# 1. the scan, small
scan_small = im.resize((720, round(H * 720 / W)), Image.LANCZOS)

# 2. ink alpha on a crop around the specimen (raw distance/darkness, then the density gate)
pad = 40
x0, y0, x1, y1 = spec['plateBox']
cx0, cy0, cx1, cy1 = max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)
crop = im.crop((cx0, cy0, cx1, cy1))
CW, CH = crop.size
carr = arr[cy0:cy1, cx0:cx1]
dist = np.sqrt(((carr - paper) ** 2).sum(-1))
raw = np.clip((dist - 0.11) / 0.20, 0, 1)
lum = carr @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
plum = float(paper @ np.array([0.299, 0.587, 0.114]))
raw = np.maximum(raw, np.clip((plum - lum - 0.10) / 0.18, 0, 1))
gated = alpha[cy0:cy1, cx0:cx1]
def rgba(rgb_arr, a):
    out = np.dstack([np.clip(rgb_arr, 0, 1), np.clip(a, 0, 1)]) * 255
    return Image.fromarray(out.astype(np.uint8))
crop_raw = rgba(carr, raw)
crop_ink = rgba(carr, gated)
specks = rgba(np.tile(np.array([0.75, 0.15, 0.1], np.float32), (CH, CW, 1)), np.clip(raw - gated, 0, 1) * (raw > 0.3))

# 3. components on the max-pooled mask, before and after the filters
k = 4
small = cb.maxpool(alpha, k) > 0.3
SH, SW = small.shape
cr, cc = small.sum(axis=1), small.sum(axis=0)
frame_rows = [r for r in range(3, SH - 3) if cr[r] > 0.45 * SW and cr[r - 3] < 0.25 * SW and cr[r + 3] < 0.25 * SW]
frame_cols = [c for c in range(3, SW - 3) if cc[c] > 0.45 * SH and cc[c - 3] < 0.25 * SH and cc[c + 3] < 0.25 * SH]
comp0, n0 = cb.label_components(small)
raw_items = []
for i in range(n0):
    ys, xs = np.where(comp0 == i)
    raw_items.append([int(xs.min()) * k, int(ys.min()) * k, int(xs.max() + 1) * k, int(ys.max() + 1) * k, int(ys.size)])
big = max(it[4] for it in raw_items)
raw_items = [it for it in raw_items if it[4] >= big * 0.002]   # leave out sub-speck noise: too many to draw
ovr = cb.OVERRIDES.get(KEY, {})
specs, comp, fills = cb.find_specimens(alpha, ovr=ovr)
kept = []
for m in specs:
    ys, xs = np.where(m)
    kept.append([int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)])
kept.sort(key=lambda b: (b[1], b[0]))

# 4. the layers as they were exported, recomposed to displayable RGBA
def layer(name):
    col = np.asarray(Image.open(f'{PLATES}/{SID}_{name}.webp').convert('RGB')).astype(np.float32) / 255
    a = np.asarray(Image.open(f'{PLATES}/{SID}_{name}_a.webp').convert('L')).astype(np.float32) / 255
    rgb = np.clip(col * 1.3 * paper, 0, 1)
    return rgba(rgb, a)
layers = {n: layer(n) for n in ('body', 'wing-L', 'wing-R')}

# 5. manifest excerpt and file list
files = sorted(f for f in os.listdir(PLATES) if f.startswith(SID))
excerpt = {k2: spec[k2] for k2 in ('id', 'rotate', 'plateBox', 'axis', 'bodyHalf', 'wingTop')}
excerpt['parts'] = {n: spec['parts'][n]['bbox'] for n in ('body', 'wing-L', 'wing-R')}

data = dict(
    key=KEY, sid=SID, W=W, H=H, paper=[round(float(c), 3) for c in paper],
    scan=b64(scan_small, 'JPEG', quality=82),
    crop=dict(box=[cx0, cy0, cx1, cy1], w=CW, h=CH,
              plain=b64(crop, 'JPEG', quality=85), raw=b64(crop_raw), ink=b64(crop_ink), specks=b64(specks)),
    frame=dict(rows=[r * k for r in frame_rows], cols=[c * k for c in frame_cols]),
    raw_items=raw_items, kept=kept,
    spec=dict(plateBox=spec['plateBox'], axis=spec['axis'], bodyHalf=spec['bodyHalf'], wingTop=spec['wingTop'],
              parts={n: dict(bbox=spec['parts'][n]['bbox'], src=b64(layers[n])) for n in layers}),
    files=files, sizes={f: os.path.getsize(f'{PLATES}/{f}') for f in files},
    excerpt=json.dumps(excerpt, indent=2),
    card=card, source=manifest['source'], plate_order=manifest['order'],
)
tpl = open(f'{ROOT}/scripts/made/how-a-book-is-cut.html', encoding='utf-8').read()
html = tpl.replace('/*__DATA__*/null', json.dumps(data))
OUT = f'{ROOT}/site/public/made/how-a-book-is-cut/index.html'
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w', encoding='utf-8').write(html)
print('components', len(raw_items), 'kept', len(kept), 'frame rows/cols', len(frame_rows), len(frame_cols))
print('wrote', os.path.relpath(OUT, ROOT), round(len(html) / 1e6, 2), 'MB')

# --- share image: the specimen on the site's paper, the series title beside it (1200 x 630) ---
og = Image.new('RGB', (1200, 630), (0xe8, 0xde, 0xc4))
bx0, by0, bx1, by1 = spec['plateBox']
sc = 560 / (bx1 - bx0)
for n in ('wing-L', 'wing-R', 'body'):
    b = spec['parts'][n]['bbox']; im2 = layers[n]
    if n == 'wing-L': im2 = im2.transpose(Image.FLIP_LEFT_RIGHT)      # exported mirrored, hinge at its left edge
    im2 = im2.resize((max(1, round((b[2] - b[0]) * sc)), max(1, round((b[3] - b[1]) * sc))), Image.LANCZOS)
    og.paste(im2, (round(40 + (b[0] - bx0) * sc), round(315 - (by1 - by0) * sc / 2 + (b[1] - by0) * sc)), im2)
d = ImageDraw.Draw(og)
try:
    F = lambda size, idx=0: ImageFont.truetype('/System/Library/Fonts/Supplemental/Baskerville.ttc', size, index=idx)
    f_small, f_big, f_body = F(26, 1), F(66), F(28, 1)
except OSError:
    f_small = f_big = f_body = ImageFont.load_default()
x = 660
d.text((x, 190), "How it's made · I", font=f_small, fill=(0xb4, 0x84, 0x2a))
d.text((x, 228), 'How a book', font=f_big, fill=(0x21, 0x1a, 0x13))
d.text((x, 300), 'is cut', font=f_big, fill=(0x21, 0x1a, 0x13))
d.text((x, 395), 'From a library scan to a butterfly\nthat lifts its wings, in seven steps.', font=f_body, fill=(0x4a, 0x3f, 0x33), spacing=6)
d.text((x, 520), 'The Aurelian Press', font=f_small, fill=(0x4a, 0x3f, 0x33))
og.save(f'{ROOT}/site/public/og/made-how-a-book-is-cut.png', optimize=True)
print('wrote site/public/og/made-how-a-book-is-cut.png')
