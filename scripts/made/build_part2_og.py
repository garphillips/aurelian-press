"""
Share image for "How it's made, part II": the Lucas front board, tipped as if lifting from the shelf, beside the
title, on the site's paper (1200 x 630) -> site/public/og/made-the-shelf-and-the-opening.png
    python3 scripts/made/build_part2_og.py
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
og = Image.new('RGB', (1200, 630), (0xe8, 0xde, 0xc4))
board = Image.open(f'{ROOT}/site/public/covers/lucas/front.jpg').convert('RGB')
bw = 380; bh = round(bw * board.height / board.width); board = board.resize((bw, bh), Image.LANCZOS)
# a perspective tip: the fore-edge (right) side nearer the viewer, the spine side receding a little
def coeffs(src, dst):
    import numpy as np
    A = []; B = []
    for (x, y), (u, v) in zip(dst, src):
        A += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]; B += [u, v]
    return tuple(np.linalg.solve(np.array(A, float), np.array(B, float)))
W, H = bw, bh
dst = [(70, 60), (W + 30, 20), (W + 30, H + 40), (70, H)]
tipped = Image.new('RGBA', (W + 120, H + 120), (0, 0, 0, 0))
tipped.paste(board, (0, 0))
tipped = tipped.transform(tipped.size, Image.PERSPECTIVE, coeffs([(0, 0), (W, 0), (W, H), (0, H)], dst), Image.BICUBIC)
shadow = Image.new('RGBA', tipped.size, (0, 0, 0, 0))
shadow.paste((60, 40, 15, 120), (0, 0, tipped.size[0], tipped.size[1]), tipped.split()[3])
shadow = shadow.filter(ImageFilter.GaussianBlur(22))
og.paste(shadow, (86, 96), shadow)
og.paste(tipped, (70, 60), tipped)
d = ImageDraw.Draw(og)
try:
    F = lambda size, idx=0: ImageFont.truetype('/System/Library/Fonts/Supplemental/Baskerville.ttc', size, index=idx)
    f_small, f_big, f_body = F(26, 1), F(62), F(25, 1)
except OSError:
    f_small = f_big = f_body = ImageFont.load_default()
x = 620
d.text((x, 170), "How it's made · II", font=f_small, fill=(0xb4, 0x84, 0x2a))
d.text((x, 208), 'The shelf and', font=f_big, fill=(0x21, 0x1a, 0x13))
d.text((x, 276), 'the opening', font=f_big, fill=(0x21, 0x1a, 0x13))
d.text((x, 375), 'Cloth and gilt painted on canvas,\nthe books in their column, the hover,\nthe lift, the swing and the paper curtain.', font=f_body, fill=(0x4a, 0x3f, 0x33), spacing=6)
d.text((x, 520), 'The Aurelian Press', font=f_small, fill=(0x4a, 0x3f, 0x33))
og.save(f'{ROOT}/site/public/og/made-the-shelf-and-the-opening.png', optimize=True)
print('wrote site/public/og/made-the-shelf-and-the-opening.png')
