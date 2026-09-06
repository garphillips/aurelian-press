"""
Build a single-file HTML review sheet of every Lucas specimen for Gareth to skim:
plate thumbnail (with cutter indices), caption name, modern name + family, match method, flags, translation.

Output: assets-src/review/lucas-review.html   (thumbnails inlined as data URIs, ~4 MB)
"""
import json, os, base64, io, html
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda rel: os.path.join(ROOT, rel)
book = json.load(open(P('content/book-plates.json'), encoding='utf-8'))
entries = json.load(open(P('content/lucas-entries.json'), encoding='utf-8'))
auto = json.load(open(P('content/species-auto.json'), encoding='utf-8'))
trans = json.load(open(P('content/translations.json'), encoding='utf-8'))
hand = json.load(open(P('content/species.json'), encoding='utf-8')) if os.path.exists(P('content/species.json')) else {}

def thumb(key):
    src = P(f'assets-src/numerals/{key}_plate.jpg')
    if not os.path.exists(src): src = next(p['file'] for p in book['plates'] if p['plateKey'] == key); src = P(src)
    im = Image.open(src).convert('RGB'); im.thumbnail((360, 560))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=70)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()

by_plate = {}
for e in entries: by_plate.setdefault(e['plateKey'], []).append(e)

CONF = {'high': '#2e7d32', 'medium': '#b26a00', 'low': '#c62828'}
rows = []
for p in book['plates']:
    key = p['plateKey']; es = by_plate.get(key, [])
    cells = []
    for e in es:
        a = auto.get(e['specimen'], {}); t = a.get('taxonomy', {})
        conf = a.get('confidence', 'low'); flags = a.get('flags', [])
        modern = t.get('accepted') or '—'
        cells.append(f"""
        <div class="sp">
          <div class="idx">{e['figure']}</div>
          <div class="names"><b>{html.escape(e['latin_1835'])}</b> <span class="loc">{html.escape(e.get('locality_1835') or '')}</span><br>
            <span class="modern" style="color:{CONF[conf]}">{html.escape(modern)}</span> <span class="fam">{html.escape(t.get('family') or '')}</span>
            {'<span class="common">· ' + html.escape(a['common_names'][0]) + '</span>' if a.get('common_names') else ''}
            {'<span class="ws">· ' + html.escape(a['wingspan']) + '</span>' if a.get('wingspan') else ''}</div>
          <div class="meta">{html.escape(t.get('method',''))} {t.get('gbif_confidence','')}% {'· ' + html.escape(', '.join(flags)) if flags else ''}
            {'· <b>hand-written</b>' if e['specimen'] in hand else ''} {'· side view' if (e.get('caption_note') or '').startswith('side') else ''}</div>
          <div class="tr">{html.escape(trans.get(e['specimen'], '')[:260])}{'…' if len(trans.get(e['specimen'], '')) > 260 else ''}</div>
        </div>""")
    rows.append(f"""
    <section class="plate" id="{key}">
      <img src="{thumb(key)}" alt="">
      <div class="body"><h2>Plate {p.get('plate', p['order'])} <small>scan {p['order']} · {key} · <a href="{p['bhlUrl']}" target="_blank" rel="noopener">BHL</a></small></h2>{''.join(cells)}</div>
    </section>""")

total = len(entries); hi = sum(1 for e in entries if auto.get(e['specimen'], {}).get('confidence') == 'high')
md = sum(1 for e in entries if auto.get(e['specimen'], {}).get('confidence') == 'medium')
doc = f"""<!doctype html><meta charset="utf-8"><title>Lucas plates — review sheet</title>
<style>
 body{{font-family:Georgia,serif;background:#f4efe3;color:#221;margin:0;padding:24px}}
 h1{{font-weight:400;margin:0 0 6px}} .sum{{color:#665;margin-bottom:22px}}
 .plate{{display:grid;grid-template-columns:200px 1fr;gap:18px;background:#fbf8f0;border:1px solid #d8cfb8;padding:14px;margin-bottom:14px}}
 .plate img{{width:200px;height:auto}} h2{{font-weight:400;margin:0 0 10px;font-size:20px}} h2 small{{font-size:12px;color:#776}}
 .sp{{display:grid;grid-template-columns:28px 1fr;gap:4px 10px;padding:8px 0;border-top:1px solid #e6dfcc}}
 .idx{{background:#b22;color:#fff;font:bold 14px/28px Helvetica,sans-serif;text-align:center;width:28px;height:28px}}
 .names{{font-size:15px}} .loc{{color:#776;font-size:12px}} .modern{{font-style:italic}} .fam{{color:#665;font-size:12px}} .common,.ws{{font-size:13px;color:#443}}
 .meta{{grid-column:2;font-size:12px;color:#665}} .tr{{grid-column:2;font-size:13px;color:#332;line-height:1.35}}
 .legend span{{display:inline-block;margin-right:14px}}
</style>
<h1>Histoire naturelle des lépidoptères exotiques — species review</h1>
<div class="sum">{total} specimens · <span style="color:{CONF['high']}">{hi} high</span> · <span style="color:{CONF['medium']}">{md} medium</span> · <span style="color:{CONF['low']}">{total-hi-md} low</span> confidence.
 Bold = Lucas's name from the plate caption; italic = accepted name today (GBIF); grey = how it was matched and any flags. Text = English rendering of Lucas's description.</div>
{''.join(rows)}"""
os.makedirs(P('assets-src/review'), exist_ok=True)
open(P('assets-src/review/lucas-review.html'), 'w', encoding='utf-8').write(doc)
print('review sheet:', len(doc) // 1024, 'KB')
