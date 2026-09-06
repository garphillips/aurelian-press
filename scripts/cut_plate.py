"""
Cut a scanned plate into rig layers: body, fore-L, fore-R, hind-L, hind-R.

Pipeline (numpy + PIL only):
  1. Estimate paper colour, derive an alpha ("ink density") from colour distance to paper.
  2. Divide the image by the paper colour so the paper becomes white and pigment survives;
     this lets the runtime multiply the print onto its own paper.
  3. Split into parts with hand-placed polygons, painting in the hindwing hidden under the forewing.
  4. Rotate upright (head at top), tight-crop each part, force wing roots to the hinge line,
     mirror left wings so every wing texture has its root on the left edge.
  5. Write WebP textures + a manifest JSON with placement in world units.

Coordinates below are for BHL/Flickr 50026094636 (Ornithoptera priamus, Pauquet), 1333x2175,
printed sideways with the head to the left.
"""
import json, os, sys, io, base64
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = sys.argv[1] if len(sys.argv) > 1 else 'assets-src/plate-50026094636/original.jpg'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'assets-src/plate-50026094636/out'
os.makedirs(OUT, exist_ok=True)

im = Image.open(SRC).convert('RGB')
W, H = im.size
arr = np.asarray(im).astype(np.float32) / 255.0

# ---------- 1. paper + alpha -------------------------------------------------
paper = np.median(arr[250:550, 700:1000].reshape(-1, 3), axis=0)
dist = np.sqrt(((arr - paper) ** 2).sum(-1))
alpha = np.clip((dist - 0.10) / 0.20, 0, 1)
lum = arr @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
plum = float(paper @ np.array([0.299, 0.587, 0.114]))
alpha = np.maximum(alpha, np.clip((plum - lum - 0.10) / 0.18, 0, 1))  # thin dark lines (antennae)

# remove isolated specks: local density test
dens = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(4))).astype(np.float32) / 255
alpha = alpha * (dens > 0.18)

# ---------- 2. paper-normalised colour --------------------------------------
norm = np.clip(arr / paper, 0, 1)

# ---------- 3. polygons (original orientation, head to the LEFT) ------------
AXIS_Y = 1036            # body axis
BODY_TOP, BODY_BOT = 988, 1084

def poly_mask(pts):
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return np.asarray(m).astype(np.float32) / 255

# boundary between forewing (left/anterior) and hindwing (right/posterior)
UP_BOUND = [(700, 645), (670, 960)]        # forewing trailing edge, upper side
LO_BOUND = [(660, 1100), (695, 1420)]      # lower side

def xb(bound, y):
    (x0, y0), (x1, y1) = bound
    return x0 + (x1 - x0) * (y - y0) / (y1 - y0)

fore_up = poly_mask([(200, 330), (240, 250), (500, 250), (760, 560), (700, 645), (670, 960), (655, BODY_TOP), (520, BODY_TOP)])
hind_up = poly_mask([(700, 645), (1040, 620), (1060, BODY_TOP), (655, BODY_TOP), (670, 960)])
fore_lo = poly_mask([(200, 1742), (240, 1822), (500, 1822), (760, 1512), (695, 1420), (660, 1100), (655, BODY_BOT), (520, BODY_BOT)])
hind_lo = poly_mask([(695, 1420), (1040, 1452), (1060, BODY_BOT), (655, BODY_BOT), (660, 1100)])

def band(pts, half):
    """thick polyline as polygon"""
    m = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(m)
    d.line(pts, fill=255, width=half * 2, joint='curve')
    for p in pts: d.ellipse([p[0]-half, p[1]-half, p[0]+half, p[1]+half], fill=255)
    return np.asarray(m).astype(np.float32) / 255

body = np.maximum.reduce([
    poly_mask([(440, BODY_TOP), (1080, BODY_TOP), (1080, BODY_BOT), (440, BODY_BOT)]),
    band([(520, 1020), (400, 890), (290, 820)], 22),     # upper antenna
    band([(520, 1052), (400, 1180), (290, 1250)], 22),   # lower antenna
])
# wings must not steal antenna pixels
fore_up = fore_up * (1 - band([(520, 1020), (400, 890), (290, 820)], 22))
fore_lo = fore_lo * (1 - band([(520, 1052), (400, 1180), (290, 1250)], 22))

def layer(mask):
    a = alpha * mask
    rgb = norm.copy()
    return rgb, a

def paint_hidden_hind(rgb, a, bound, y0, y1, width=58, rng=np.random.default_rng(3)):
    """Reconstruct the hindwing region hidden under the forewing by extending visible colour leftwards."""
    for y in range(y0, y1):
        t = (y - y0) / max(1, (y1 - y0))
        w = int(width * np.sqrt(np.sin(np.pi * min(max(t, 0.02), 0.98))))
        b = int(round(xb(bound, y)))
        sample = norm[y, b + 12: b + 34]
        if sample.size == 0: continue
        col = sample.mean(axis=0)
        xs = np.arange(b - w, b + 2)
        noise = rng.normal(0, 0.03, size=(xs.size, 3)).astype(np.float32)
        rgb[y, xs] = np.clip(col + noise, 0, 1)
        a[y, xs] = 1.0
    return rgb, a

parts = {}
parts['fore-R'] = layer(fore_up)                      # upper side becomes RIGHT after rotation
parts['hind-R'] = paint_hidden_hind(*layer(hind_up), UP_BOUND, 700, BODY_TOP)
parts['fore-L'] = layer(fore_lo)
parts['hind-L'] = paint_hidden_hind(*layer(hind_lo), LO_BOUND, BODY_BOT, 1400)
parts['body']   = layer(body)

# ---------- 4. rotate upright and crop ---------------------------------------
def rot(a):  # 90° clockwise: head (left) -> top
    return np.rot90(a, k=-1)

# hinge lines in rotated coords: x' = (H-1) - y
HINGE_R = (H - 1) - BODY_TOP + 1      # right wings root at this x (their crop starts here)
HINGE_L = (H - 1) - BODY_BOT          # left wings root: crop ends here
AXIS_X = (H - 1) - AXIS_Y

manifest = {'source': os.path.basename(SRC), 'canvas': [H, W], 'axisX': AXIS_X, 'parts': {}}
pad = 6
for name, (rgb, a) in parts.items():
    rgb, a = rot(rgb), rot(a)
    ys, xs = np.where(a > 0.02)
    y0, y1 = max(0, ys.min() - pad), min(H2 := a.shape[0], ys.max() + pad)
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad)
    if name.endswith('-R'): x0 = HINGE_R
    if name.endswith('-L'): x1 = HINGE_L
    crop_rgb, crop_a = rgb[y0:y1, x0:x1], a[y0:y1, x0:x1]
    if name.endswith('-L'):                       # mirror so the root is on the left edge
        crop_rgb, crop_a = crop_rgb[:, ::-1], crop_a[:, ::-1]
    over_white = crop_rgb * crop_a[..., None] + (1 - crop_a[..., None])
    Image.fromarray((over_white * 255).astype(np.uint8)).save(f'{OUT}/{name}.webp', quality=92, method=6)
    Image.fromarray((crop_a * 255).astype(np.uint8)).save(f'{OUT}/{name}_a.webp', lossless=True, method=6)
    manifest['parts'][name] = {'bbox': [int(x0), int(y0), int(x1), int(y1)], 'w': int(x1 - x0), 'h': int(y1 - y0)}
    print(f'{name:8s} bbox={x0},{y0},{x1},{y1}  {x1-x0}x{y1-y0}')

# body reference: centre of the body crop
bb = manifest['parts']['body']['bbox']
manifest['bodyCenter'] = [AXIS_X, (bb[1] + bb[3]) / 2]
manifest['hinge'] = {'R': HINGE_R, 'L': HINGE_L}
json.dump(manifest, open(f'{OUT}/manifest.json', 'w'), indent=1)

# preview composite for eyeballing
comp = np.ones((H2, a.shape[1], 3), dtype=np.float32)
for name in ['hind-R', 'hind-L', 'fore-R', 'fore-L', 'body']:
    rgb, a = rot(parts[name][0]), rot(parts[name][1])
    comp = comp * (1 - a[..., None]) + rgb * a[..., None]
Image.fromarray((comp * 255).astype(np.uint8)).save(f'{OUT}/preview.jpg', quality=85)
print('paper colour', paper, 'axisX', AXIS_X, 'hinges', HINGE_L, HINGE_R)
