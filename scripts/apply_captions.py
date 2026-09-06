"""
Re-key the Lucas species records by the handwritten plate captions (content/captions.json), which were
read off the scans specimen by specimen. Captions win over the OCR'd index: they fix the genus Lucas
actually used (Terias, Idmais, Eurybia ...), the figure order within a plate, and the two out-of-sequence
binding runs.

  content/lucas-entries.parsed.json   <- backup of the parser's output (first run only)
  content/lucas-entries.json          -> one record per cut specimen, keyed "n<leaf>-<idx>"
  content/translations.json           -> re-keyed to the new specimen ids
"""
import json, os, re, shutil, difflib, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda rel: os.path.join(ROOT, rel)
book = json.load(open(P('content/book-plates.json'), encoding='utf-8'))
caps = json.load(open(P('content/captions.json'), encoding='utf-8'))
if not os.path.exists(P('content/lucas-entries.parsed.json')):
    shutil.copy(P('content/lucas-entries.json'), P('content/lucas-entries.parsed.json'))
parsed = json.load(open(P('content/lucas-entries.parsed.json'), encoding='utf-8'))
trans = json.load(open(P('content/translations.json'), encoding='utf-8'))

def norm(s):
    s = ''.join(c for c in unicodedata.normalize('NFD', (s or '').lower()) if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z]', '', s.replace('œ', 'oe').replace('æ', 'ae'))
def stem(s): return re.sub(r'(us|um|is|ae|ii|a|e|i)$', '', norm(s))
def sim(a, b): return difflib.SequenceMatcher(None, stem(a), stem(b)).ratio()

plate_of = {p['plateKey']: p.get('plate', p['order']) for p in book['plates']}
used = set(); out = []; unmatched = []
for key in [p['plateKey'] for p in book['plates']]:
    items = caps.get(key, [])
    plate = plate_of[key]
    pool = [e for e in parsed if e['plate'] == plate]
    for i, item in enumerate(items, 1):
        genus, epithet, locality = item[0], item[1], item[2]
        note = item[3] if len(item) > 3 else None
        # 1. same printed plate, best epithet match; 2. anywhere in the index (OCR sometimes broke the plate number)
        best, score = None, 0
        for cand in pool + parsed:
            if id(cand) in used: continue
            s = sim(epithet, cand['epithet'])
            if cand not in pool: s -= 0.1
            if s > score: best, score = cand, s
        e = dict(best) if best and score >= 0.7 else {}
        if best and score >= 0.7: used.add(id(best))
        else: unmatched.append((key, i, genus, epithet))
        rec = {
            'specimen': f'{key}-{i}', 'plateKey': key, 'plate': plate, 'figure': i,
            'genus': genus, 'epithet': epithet, 'latin_1835': f'{genus} {epithet.lower()}',
            'locality_1835': locality or None, 'caption_note': note,
            'french': e.get('french'), 'page': e.get('page'), 'heading': e.get('heading'), 'text_fr': e.get('text_fr', ''),
            'index_match': round(score, 2) if best else None, 'parsed_specimen': e.get('specimen'),
        }
        out.append(rec)

# texts that the parser attached to the wrong species: re-attach by the Latin name at the head of the text
by_new = {r['specimen']: r for r in out}
for r in out:
    if r['text_fr']: continue
    for e in parsed:
        head = re.match(r'^\s*(?:[A-Z][a-z]+\s+)?([A-Za-zœæ]+)', e.get('text_fr') or '')
        if head and sim(r['epithet'], head.group(1)) >= 0.9 and e['plate'] == r['plate']:
            r['text_fr'] = e['text_fr']; r['heading'] = e.get('heading'); r['parsed_specimen'] = e.get('specimen'); r['text_reattached'] = True; break

# re-key translations: old parser specimen id -> new caption specimen id
new_trans = {k: v for k, v in trans.items() if k.startswith('_')}
old_to_new = {r['parsed_specimen']: r['specimen'] for r in out if r.get('parsed_specimen')}
lost = []
for k, v in trans.items():
    if k.startswith('_'): continue
    if k in old_to_new: new_trans[old_to_new[k]] = v
    else: lost.append(k)
# translations flagged as mismatched belong to the species named in the text, which re-attachment now finds
for old, new in old_to_new.items():
    if old in trans.get('_mismatch', {}) and new in new_trans: pass

json.dump(out, open(P('content/lucas-entries.json'), 'w'), ensure_ascii=False, indent=1)
json.dump(new_trans, open(P('content/translations.json'), 'w'), ensure_ascii=False, indent=1)
print(f'specimens: {len(out)}  with index entry: {sum(1 for r in out if r["page"])}  with text: {sum(1 for r in out if r["text_fr"])}  '
      f'translations kept: {len([k for k in new_trans if k.startswith("n")])}  lost: {lost}')
print('caption species with no index entry:', unmatched)
print('genus changed by caption:', sum(1 for r in out if r.get('parsed_specimen') and next((e for e in parsed if e['specimen']==r['parsed_specimen']), {}).get('genus','').lower() != r['genus'].lower()))
