"""
Build the site's content file for the Lucas book:  site/public/books/lucas/content/plates.json

Sources, in increasing priority:
  content/lucas-entries.json      parsed 1835 index + body text (French), one record per species, assigned to a
                                  cut specimen by plate and page order (or by content/figure-map.json when present)
  content/species-auto.json       GBIF / Wikipedia / Wikidata enrichment keyed by specimen id
  content/translations.json       English rendering of Lucas's description, keyed by specimen id
  content/species.json            hand-written content (wins over everything)
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def load(rel, default):
    p = f'{ROOT}/{rel}'
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else default

book = load('content/book-plates.json', {})
entries = load('content/lucas-entries.json', [])
auto = load('content/species-auto.json', {})
trans = load('content/translations.json', {})
etym = load('content/etymology.json', {})
hand = load('content/species.json', {})
figmap = load('content/figure-map.json', {})

def first_sentences(text, n=2, maxlen=320):
    sents = re.split(r'(?<=[.!?])\s+', text.strip())
    out = ' '.join(sents[:n]).strip()
    return out if len(out) <= maxlen else out[:maxlen].rsplit(' ', 1)[0] + '…'

plates = {p['plateKey']: {'order': p['order'], 'bhlUrl': p.get('bhlUrl'), 'flickrUrl': p.get('flickrUrl')} for p in book['plates']}

# specimen id -> text entry. Default: the parser's page-order assignment; a figure map (plateKey -> cutter idx -> figure) overrides it.
by_sid = {e['specimen']: e for e in entries if e.get('specimen')}
if figmap:
    order_of = {p['plateKey']: p['order'] for p in book['plates']}
    by_plate_fig = {}
    for e in entries:                       # figure = position in page order within the plate
        by_plate_fig.setdefault(e['plate'], []).append(e)
    for pl in by_plate_fig: by_plate_fig[pl].sort(key=lambda e: e['page'])
    by_sid = {}
    for key, fm in figmap.items():
        for idx, f in fm.items():
            lst = by_plate_fig.get(order_of.get(key), [])
            fig = f.get('figure')
            if fig and fig <= len(lst): by_sid[f'{key}-{idx}'] = {**lst[fig - 1], 'shared': f.get('shared', False)}

specimens = {}
for sid, e in by_sid.items():
    a = auto.get(e.get('specimen'), {}); tax = a.get('taxonomy', {})
    info = {
        'latin': tax.get('accepted') or e.get('latin_1835'),
        'latin1835': e.get('latin_1835'),
        'french1835': e.get('french'),
        'name': (a.get('common_names') or [None])[0],
        'family': tax.get('family'),
        'wingspan': a.get('wingspan'),
        'range': ("Lucas's specimen: " + e['locality_1835']) if e.get('locality_1835') and e['locality_1835'] != '?' else None,
        'confidence': 'ocr',
        'facts': [],
    }
    t = trans.get(e.get('specimen')) or trans.get(sid)
    if t: info['facts'].append('Lucas, 1835: “' + first_sentences(t, 3, 420) + '”')
    if a.get('wikipedia', {}) and a['wikipedia'].get('extract'):
        info['facts'].append(first_sentences(a['wikipedia']['extract'], 2, 300))
    if tax.get('synonym_of_1835_name') and tax.get('accepted') and e.get('latin_1835'):
        info['facts'].append(f"Lucas called it {e['latin_1835']}; the accepted name today is {tax['accepted']}.")
    ety = etym.get(e['specimen']) or etym.get((e.get('epithet') or '').lower())
    if ety: info['facts'].append(ety)
    if e.get('shared'): info['facts'].append('A second figure of the same species on this plate.')
    h = dict(hand.get(sid, {}))
    if h.get('facts'):
        # hand-written facts lead; keep Lucas's excerpt and the name note, drop the Wikipedia stand-in
        auto_keep = [f for f in info['facts'] if f.startswith('Lucas, 1835') or f in (etym.get(e['specimen']), etym.get((e.get('epithet') or '').lower()))]
        h['facts'] = h['facts'] + auto_keep
        h.setdefault('confidence', 'written')
    info.update(h)
    specimens[sid] = {k: v for k, v in info.items() if v not in (None, '', [])}

content = {'book': {'title': book.get('title'), 'publisher': book.get('publisher'), 'years': book.get('years'), 'engraver': book.get('engraver'),
                    'bhlItem': book.get('bhlItem'), 'flickrAlbum': book.get('flickrAlbum')},
           'plates': plates, 'specimens': specimens}
os.makedirs(f'{ROOT}/site/public/books/lucas/content', exist_ok=True)
json.dump(content, open(f'{ROOT}/site/public/books/lucas/content/plates.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(f"plates.json: {len(plates)} plates, {len(specimens)} specimens, {sum(1 for s in specimens.values() if s.get('latin'))} with Latin, "
      f"{sum(1 for s in specimens.values() if s.get('family'))} enriched, {sum(1 for s in specimens.values() if any(f.startswith('Lucas, 1835') for f in s.get('facts', [])))} with a Lucas excerpt")
