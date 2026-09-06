"""
Automatic cutter for every plate in the book.

For each scan:
  1. paper colour -> ink alpha (colour distance + darkness), speck cleanup
  2. connected components on a max-pooled mask -> drop the frame line and captions, keep specimens
  3. per specimen: orientation (sideways singles rotated head-up), symmetry axis, body band,
     antenna rows (sparse rows above the wings), then split into body / wing-L / wing-R
  4. export paper-normalised colour + alpha as WebP, plus a manifest with placement in plate pixels

Overrides per plate live in content/plate-overrides.json (rotation, body width, drop/merge components).
Usage: python3 scripts/cut_book.py [plateKey ...]      (no args = all plates)
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOK = json.load(open(f'{ROOT}/content/book-plates.json'))
OVR_PATH = f'{ROOT}/content/plate-overrides.json'
OVERRIDES = json.load(open(OVR_PATH)) if os.path.exists(OVR_PATH) else {}
OUT_ROOT = f'{ROOT}/site/public/plates'
REVIEW = f'{ROOT}/assets-src/review'
os.makedirs(REVIEW, exist_ok=True)

# ----------------------------------------------------------------------------
def ink_alpha(arr):
    paper = np.median(arr.reshape(-1, 3), axis=0)
    dist = np.sqrt(((arr - paper) ** 2).sum(-1))
    alpha = np.clip((dist - 0.11) / 0.20, 0, 1)
    lum = arr @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    plum = float(paper @ np.array([0.299, 0.587, 0.114]))
    alpha = np.maximum(alpha, np.clip((plum - lum - 0.10) / 0.18, 0, 1))
    dens = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(3))).astype(np.float32) / 255
    alpha = alpha * (dens > 0.16)
    return alpha, paper

def maxpool(a, k):
    H, W = a.shape
    H2, W2 = H // k, W // k
    return a[:H2 * k, :W2 * k].reshape(H2, k, W2, k).max(axis=(1, 3))

def label_components(mask):
    """Connected components (8-neighbour) by BFS on a small boolean mask."""
    from collections import deque
    H, W = mask.shape
    comp = np.full((H, W), -1, np.int32)
    n = 0
    for sy in range(H):
        row = mask[sy]
        for sx in range(W):
            if not row[sx] or comp[sy, sx] >= 0: continue
            q = deque([(sy, sx)]); comp[sy, sx] = n
            while q:
                y, x = q.popleft()
                for dy in (-1, 0, 1):
                    yy = y + dy
                    if yy < 0 or yy >= H: continue
                    for dx in (-1, 0, 1):
                        xx = x + dx
                        if xx < 0 or xx >= W or comp[yy, xx] >= 0 or not mask[yy, xx]: continue
                        comp[yy, xx] = n; q.append((yy, xx))
            n += 1
    return comp, n

def fill_holes(m_small, k, full_shape):
    """Silhouette of a specimen: everything not reachable from the bbox border on the small mask, upscaled and softened."""
    from collections import deque
    ys, xs = np.where(m_small)
    y0, y1, x0, x1 = ys.min() - 1, ys.max() + 2, xs.min() - 1, xs.max() + 2
    sub = np.pad(m_small[max(0, y0):y1, max(0, x0):x1], 1)
    H, W = sub.shape
    outside = np.zeros_like(sub, dtype=bool)
    q = deque([(0, 0)]); outside[0, 0] = True
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W and not outside[yy, xx] and not sub[yy, xx]:
                outside[yy, xx] = True; q.append((yy, xx))
    filled = ~outside
    filled = filled[1:-1, 1:-1]
    out_small = np.zeros_like(m_small, dtype=bool)
    oy, ox = max(0, y0), max(0, x0)
    out_small[oy:oy + filled.shape[0], ox:ox + filled.shape[1]] = filled
    big = np.kron(out_small, np.ones((k, k), dtype=np.float32))
    full = np.zeros(full_shape, dtype=np.float32); full[:big.shape[0], :big.shape[1]] = big
    # soften the blocky edge and pull it inside the ink outline slightly
    soft = np.asarray(Image.fromarray((full * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(2))).astype(np.float32) / 255
    return soft

def find_specimens(alpha, k=4, ovr=None):
    small = maxpool(alpha, k) > 0.3
    H, W = small.shape
    # erase the plate's frame line: long thin runs spanning most of a row/column
    cr = small.sum(axis=1); cc = small.sum(axis=0)
    for r in range(3, H - 3):
        if cr[r] > 0.45 * W and cr[r - 3] < 0.25 * W and cr[r + 3] < 0.25 * W: small[r - 1:r + 2, :] = False
    for c in range(3, W - 3):
        if cc[c] > 0.45 * H and cc[c - 3] < 0.25 * H and cc[c + 3] < 0.25 * H: small[:, c - 1:c + 2] = False
    for y in (ovr or {}).get('splitY', []):                 # manual cut lines (plate px) between touching specimens
        small[max(0, y // k - 1):y // k + 2, :] = False
    comp, n = label_components(small)
    items = []
    for i in range(n):
        ys, xs = np.where(comp == i)
        area = ys.size
        bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
        fill = area / (bw * bh)
        items.append(dict(i=i, area=area, bbox=[xs.min(), ys.min(), xs.max() + 1, ys.max() + 1], fill=fill))
    if not items: return [], comp
    big = max(it['area'] for it in items)
    keep = []
    for it in items:
        bx0, by0, bx1, by1 = it['bbox']
        bw, bh = bx1 - bx0, by1 - by0
        if it['fill'] < 0.12 and bw > W * 0.5: continue                                   # frame line
        if it['area'] < big * 0.02: continue                                              # specks
        if bh < H * 0.04 or bw < W * 0.04: continue                                       # handwriting, dashes
        if bw > W * 0.6 and bh < H * 0.08: continue                                       # scanner bands
        if bx0 <= 1 or by0 <= 1 or bx1 >= W - 1 or by1 >= H - 1: continue                # touches the scan edge
        if by0 > H * 0.86: continue                                                       # caption zone
        if it['area'] < big * 0.08 and (bw / bh > 2.4 or it['fill'] < 0.32): continue   # handwriting
        keep.append(it)
    # merge components whose boxes overlap (a specimen split into pieces, e.g. a detached tail)
    merged = True
    while merged:
        merged = False
        for a in range(len(keep)):
            for b in range(a + 1, len(keep)):
                A, B = keep[a]['bbox'], keep[b]['bbox']
                ix = max(0, min(A[2], B[2]) - max(A[0], B[0])); iy = max(0, min(A[3], B[3]) - max(A[1], B[1]))
                smaller = min((A[2]-A[0])*(A[3]-A[1]), (B[2]-B[0])*(B[3]-B[1]))
                if ix * iy > 0.6 * smaller:                       # a fragment mostly inside the other box
                    keep[a]['bbox'] = [min(A[0], B[0]), min(A[1], B[1]), max(A[2], B[2]), max(A[3], B[3])]
                    keep[a]['ids'] = keep[a].get('ids', [keep[a]['i']]) + keep[b].get('ids', [keep[b]['i']])
                    keep[a]['area'] += keep[b]['area']; del keep[b]; merged = True; break
            if merged: break
    for it in keep: it.setdefault('ids', [it['i']])
    keep.sort(key=lambda it: it['bbox'][1])
    # full-res masks
    specs = []; fills = []
    for it in keep:
        m_small = np.isin(comp, it['ids'])
        m = np.kron(m_small, np.ones((k, k), dtype=bool))
        full = np.zeros(alpha.shape, dtype=bool); full[:m.shape[0], :m.shape[1]] = m
        # grow a little so soft edges survive
        full = np.asarray(Image.fromarray(full.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5))) > 0
        specs.append(full)
        fills.append(fill_holes(m_small, k, alpha.shape))
    return specs, comp, fills

def split_specimen(rgb, a, ovr):
    """rgb, a: specimen-only arrays in *upright* orientation. Returns parts dict + geometry."""
    H, W = a.shape
    ys, xs = np.where(a > 0.05)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    span = x1 - x0
    # symmetry axis: alpha-weighted centroid, refined by mirror correlation search
    col = a.sum(axis=0); cx = float((col * np.arange(W)).sum() / max(col.sum(), 1))
    best, best_s = cx, -1
    for dx in range(-int(span * 0.06), int(span * 0.06) + 1, 2):
        c = int(round(cx + dx)); w = min(c - x0, x1 - c)
        if w < 10: continue
        L = a[:, c - w:c]; R = a[:, c:c + w][:, ::-1]
        s = (L * R).sum() / (np.sqrt((L * L).sum() * (R * R).sum()) + 1e-6)
        if s > best_s: best_s, best = s, c
    axis = int(round(ovr.get('axis', best)))
    bh = int(ovr.get('bodyHalf', max(10, round(span * 0.035))))
    # antenna rows: sparse rows above the first dense row
    row = (a > 0.3).sum(axis=1)
    dense = np.where(row > span * 0.18)[0]
    wing_top = int(dense.min()) if dense.size else y0
    wing_top = int(ovr.get('wingTop', wing_top))
    body = np.zeros_like(a, dtype=bool)
    body[:, max(0, axis - bh):axis + bh] = True
    body[:wing_top, max(0, axis - 6 * bh):axis + 6 * bh] = True     # antennae, but not wing tips rising above the head
    body &= a > 0.02
    left = (a > 0.02) & ~body; left[:, axis - bh:] = False
    right = (a > 0.02) & ~body; right[:, :axis + bh] = False
    return {'body': body, 'wing-L': left, 'wing-R': right}, dict(axis=axis, bodyHalf=bh, wingTop=wing_top, bbox=[int(x0), int(y0), int(x1), int(y1)])

def mirror_score(a, axis):
    """best mirror-symmetry score of alpha `a` about a vertical (axis=1) or horizontal (axis=0) line"""
    if axis == 0: a = a.T
    H, W = a.shape
    col = a.sum(axis=0); cx = float((col * np.arange(W)).sum() / max(col.sum(), 1))
    best = 0
    for dx in range(-int(W * 0.08), int(W * 0.08) + 1, max(1, W // 60)):
        c = int(round(cx + dx)); w = min(c, W - c)
        if w < 4: continue
        L = a[:, c - w:c]; R = a[:, c:c + w][:, ::-1]
        best = max(best, (L * R).sum() / (np.sqrt((L * L).sum() * (R * R).sum()) + 1e-6))
    return best

def detect_orientation(a, plate_w=None):
    """'none' if the specimen is upright (left-right symmetric), else 'cw'/'ccw' so the head ends up on top."""
    if plate_w and a.shape[1] < plate_w * 0.35: return 'none'   # sideways plates are always large singles
    small = maxpool(a, 3)
    if mirror_score(small, 1) >= mirror_score(small, 0) - 0.03: return 'none'
    r = np.rot90(small, k=-1)                      # try clockwise
    span = (r > 0.3).any(axis=0).sum()
    row = (r > 0.3).sum(axis=1); sparse = row < span * 0.18
    top = 0
    while top < len(sparse) and sparse[top]: top += 1
    bot = 0
    while bot < len(sparse) and sparse[-1 - bot]: bot += 1
    # both ends are narrow (antennae vs abdomen); the antennae end carries far less ink per row
    top_ink = row[:top].mean() if top else 1e9
    bot_ink = row[len(row) - bot:].mean() if bot else 1e9
    return 'cw' if top_ink <= bot_ink else 'ccw'

def export_part(rgb, a, mask, out, name, hinge=None, mirror=False, pad=6):
    am = a * mask
    ys, xs = np.where(am > 0.02)
    if ys.size == 0: return None
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad)
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad)
    if hinge is not None:
        if mirror: x1 = hinge
        else: x0 = hinge
    crop_rgb, crop_a = rgb[y0:y1, x0:x1], am[y0:y1, x0:x1]
    if mirror: crop_rgb, crop_a = crop_rgb[:, ::-1], crop_a[:, ::-1]
    over_white = crop_rgb * crop_a[..., None] + (1 - crop_a[..., None])
    Image.fromarray((over_white * 255).astype(np.uint8)).save(f'{out}/{name}.webp', quality=90, method=6)
    Image.fromarray((crop_a * 255).astype(np.uint8)).save(f'{out}/{name}_a.webp', lossless=True, method=6)
    return dict(bbox=[int(x0), int(y0), int(x1), int(y1)], w=int(x1 - x0), h=int(y1 - y0))

def process_plate(plate):
    key = plate['plateKey']
    ovr = OVERRIDES.get(key, {})
    im = Image.open(f"{ROOT}/{plate['file']}").convert('RGB')
    arr = np.asarray(im).astype(np.float32) / 255
    alpha, paper = ink_alpha(arr)
    norm = np.clip(arr / paper, 0, 1.3) / 1.3      # runtime scales x1.3: >1 means pigment lighter than the paper (whites)
    specs, comp, fills = find_specimens(alpha, ovr=ovr)
    if 'keep' in ovr:
        specs = [specs[i] for i in ovr['keep'] if i < len(specs)]; fills = [fills[i] for i in ovr['keep'] if i < len(fills)]
    # drop fragments (frame bits, handwriting) far smaller than the plate's largest specimen
    areas = [int(m.sum()) for m in specs]
    if areas:
        big = max(areas); fills = [f for f, a in zip(fills, areas) if a >= 0.07 * big]; specs = [m for m, a in zip(specs, areas) if a >= 0.07 * big]
    H, W = alpha.shape
    out = f'{OUT_ROOT}/{key}'; os.makedirs(out, exist_ok=True)
    manifest = dict(plateKey=key, order=plate['order'], canvas=[W, H], paper=[float(c) for c in paper],
                    source=dict(flickr=plate['flickrUrl'], bhl=plate['bhlUrl']), specimens=[])
    review = np.ones((H, W, 3), dtype=np.float32)
    for si, m in enumerate(specs):
        sovr = ovr.get('specimens', {}).get(str(si), {})
        a = np.maximum(alpha * m, fills[si] * 0.995); rgb = norm   # ink alpha, or the filled silhouette (white wings)
        ys, xs = np.where(a > 0.05); bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        sideways = sovr.get('rotate', ovr.get('rotate', 'auto'))
        if sideways == 'auto': sideways = detect_orientation(a[by0:by1, bx0:bx1], plate_w=W)
        if sideways == 'cw':   rgb_u, a_u = np.rot90(rgb, k=-1), np.rot90(a, k=-1)
        elif sideways == 'ccw': rgb_u, a_u = np.rot90(rgb, k=1), np.rot90(a, k=1)
        else: rgb_u, a_u = rgb, a
        parts, geo = split_specimen(rgb_u, a_u, sovr)
        sid = f'{key}-{si + 1}'
        sp = dict(id=sid, rotate=sideways, plateBox=[int(bx0), int(by0), int(bx1), int(by1)], **geo, parts={})
        sp['parts']['body'] = export_part(rgb_u, a_u, parts['body'], out, f'{sid}_body')
        sp['parts']['wing-R'] = export_part(rgb_u, a_u, parts['wing-R'], out, f'{sid}_wing-R', hinge=geo['axis'] + geo['bodyHalf'])
        sp['parts']['wing-L'] = export_part(rgb_u, a_u, parts['wing-L'], out, f'{sid}_wing-L', hinge=geo['axis'] - geo['bodyHalf'], mirror=True)
        manifest['specimens'].append(sp)
        # review composite (upright frame drawn into plate frame only when not rotated)
        if sideways == 'none':
            tint = np.array([[1, .6, .6], [.6, 1, .6], [.6, .6, 1]], dtype=np.float32)
            for pi, pn in enumerate(['body', 'wing-L', 'wing-R']):
                pm = parts[pn] & (a > 0.05)
                review[pm] = review[pm] * 0 + rgb[pm] * tint[pi]
        else:
            pm = a > 0.05; review[pm] = rgb[pm] * np.array([.7, .7, 1], dtype=np.float32)
    json.dump(manifest, open(f'{out}/manifest.json', 'w'), indent=0)
    rv = Image.fromarray((review * 255).astype(np.uint8)); rv.thumbnail((450, 750)); rv.save(f'{REVIEW}/{key}.jpg', quality=80)
    return manifest

if __name__ == '__main__':
    wanted = set(sys.argv[1:])
    index = []
    for plate in BOOK['plates']:
        if wanted and plate['plateKey'] not in wanted: continue
        m = process_plate(plate)
        index.append(dict(plateKey=plate['plateKey'], order=plate['order'], specimens=[s['id'] for s in m['specimens']],
                          rotate=[s['rotate'] for s in m['specimens']]))
        print(f"{plate['plateKey']:5s} specimens={len(m['specimens'])} {[s['rotate'] for s in m['specimens']]}", flush=True)
    if not wanted:
        json.dump(index, open(f'{OUT_ROOT}/index.json', 'w'), indent=0)
