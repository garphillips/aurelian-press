"""Inline the cut layers into the template as data URIs -> a single shareable HTML file."""
import json, base64, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'assets-src/plate-50026094636/out')
m = json.load(open(os.path.join(OUT_DIR, 'manifest.json')))
for name, part in m['parts'].items():
    for key, suffix in (('rgb', ''), ('alpha', '_a')):
        with open(os.path.join(OUT_DIR, f'{name}{suffix}.webp'), 'rb') as f:
            part[key] = 'data:image/webp;base64,' + base64.b64encode(f.read()).decode()
tpl = open(os.path.join(ROOT, 'mvp/birdwing.template.html'), encoding='utf-8').read()
html = tpl.replace('__MANIFEST_JSON__', json.dumps(m))
dst = os.path.join(ROOT, 'mvp/birdwing.html')
open(dst, 'w', encoding='utf-8').write(html)
print(dst, f'{len(html)/1024:.0f} KB')
