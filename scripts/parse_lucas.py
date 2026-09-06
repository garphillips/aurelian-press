"""
Parse the Internet Archive OCR of Lucas, *Histoire naturelle des lépidoptères exotiques* (1835)
into one record per species: French name, Latin name as Lucas wrote it, page, plate, and his
description (French). Then assign each record to a cut specimen (plateKey-figure) by plate and
page order.

Inputs : assets-src/text/lucas_ocr.txt, content/book-plates.json, site/public/plates/*/manifest.json
Output : content/lucas-entries.json  (+ a printed summary of gaps to check)
"""
import json, re, glob, os, difflib, unicodedata
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OCR = os.path.join(ROOT, 'assets-src/text/lucas_ocr.txt')
lines = open(OCR, encoding='utf-8').read().split('\n')

def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
def norm(s):
    s = strip_accents(s.lower())
    return re.sub(r'[^a-z]', '', s)

# ---------------------------------------------------------------- 1. index (Table des matières)
idx_start = next(i for i, l in enumerate(lines) if 'TABLE DES MATI' in l)
idx_end = next(i for i, l in enumerate(lines) if 'fin de la table' in l.lower())
tokens = [l.strip() for l in lines[idx_start + 1: idx_end] if l.strip()]
SKIP = re.compile(r'^(ESP[ÈE]CES|PAGES|PLANCH|LEP\. EX|TABLE)', re.I)
tokens = [t for t in tokens if not SKIP.match(t)]
def clean_num(t):
    u = re.sub(r'[•\.,—\-\s]', '', t)
    return u if re.fullmatch(r'\d{1,3}', u) and re.search(r'\d', t) and len(re.sub(r'[\d•\.,—\-\s]', '', t)) == 0 else t
tokens = [clean_num(t) for t in tokens]
isnum = lambda t: bool(re.fullmatch(r'\d{1,3}', t))
index, pending = [], []
k = 0
while k < len(tokens):
    t = tokens[k]
    if isnum(t) and k + 1 < len(tokens) and isnum(tokens[k + 1]):
        page, plate = int(t), int(tokens[k + 1])
        names = [x.rstrip('.').strip() for x in pending if not isnum(x)]
        if len(names) == 1: fr = la = names[0]
        elif len(names) >= 2: fr, la = names[-2], names[-1]
        else: fr = la = '?'
        index.append({'french': fr, 'epithet': la, 'page': page, 'plate': plate, 'raw_names': names})
        pending = []; k += 2; continue
    if not isnum(t): pending.append(t)     # lone numbers are index page footers
    k += 1
index = [e for e in index if 1 <= e['plate'] <= 80]
# manual fixes for rows the OCR destroyed (content/lucas-fixes.json: {"add": [...], "drop": [[page, plate], ...]})
fixes_path = os.path.join(ROOT, 'content/lucas-fixes.json')
if os.path.exists(fixes_path):
    fx = json.load(open(fixes_path))
    drop = {tuple(d) for d in fx.get('drop', [])}
    index = [e for e in index if (e['page'], e['plate']) not in drop]
    for a in fx.get('add', []): index.append({'raw_names': [a['french'], a['epithet']], **a})

# ---------------------------------------------------------------- 2. body headings
GENRE = re.compile(r"^[GC][EÉ][NB][RB]E\s+([A-ZÉÈÊÀÂÎÔÛÇ0-9' \-]+?)\.?(?:\s+([A-Za-zéèïî]+)\.?)?\s*$", re.U)
CANON = ['ornithoptera','papilio','pieris','leucophasia','anthocharis','idmais','colias','callidryas','erycina','myrina',
         'polyommatus','danais','euploea','idea','heliconia','acraea','cethosia','argynnis','vanessa','libythea','biblis',
         'melanitis','nymphalis','morpho','brassolis','eumenia','satyrus','hesperia','thecla','castnia','urania','pavonia']
def snap_genus(raw):
    if not raw: return None
    r = norm(raw.replace('1','i').replace('0','o'))
    best = difflib.get_close_matches(r, CANON, n=1, cutoff=0.72)
    return best[0] if best else r
def genus_after(i):
    for j in range(i + 1, min(i + 4, len(lines))):
        l = lines[j].strip()
        if not l: continue
        m = re.match(r"([A-Za-zÀ-ÿ0-9 ]{3,}?)\.", l)
        return snap_genus(m.group(1).replace(' ', '')) if m else None
    return None
def upper_ratio(s):
    letters = [c for c in s if c.isalpha()]
    return sum(c.isupper() for c in letters) / max(1, len(letters))
STOP = re.compile(r'^(PAPILLONS DE JOUR|LEP\. EX|TABLE|HISTOIRE|AVANT|ATTACH|PARIS|PAUQUET|OUVRAGE|DES$|EXOTIQUES|L[ÉE]PIDOPT)', re.I)

headings = []   # (line_no, kind, text)
for i in range(idx_start):
    l = lines[i].strip()
    if len(l) < 6: continue
    m = GENRE.match(l)
    if m:
        headings.append((i, 'genre', l, snap_genus(m.group(2)) if m.group(2) else genus_after(i)))
        continue
    words = l.split()
    if len(words) >= 2 and upper_ratio(' '.join(words[:2])) > 0.85 and not STOP.match(l) and len(words[0]) >= 3 and len(words[1]) >= 2:
        # species heading: uppercase French name, Latin usually on the same line in lowercase
        headings.append((i, 'species', l, None))

# Latin name attached to each species heading: lowercase words on the line, or on the next lines
def latin_for(i, line):
    m = re.search(r'\b([a-zéèïî]{4,})\s+([a-zéèïî\-]{3,})\b', line.lower().replace('’', ''))
    if m and not m.group(1).startswith(('boisd', 'god', 'fab', 'linn')):
        return m.group(1), m.group(2)
    for j in range(i + 1, min(i + 4, len(lines))):
        l = lines[j].strip()
        if not l: continue
        m = re.match(r'([A-Za-zéèïî]{4,})\s+([A-Za-zéèïî\-]{3,})', l)
        if m and upper_ratio(l) > 0.6:  # e.g. "ORNITHOPTERA RHADAMANTUS. BOISD."
            return m.group(1).lower(), m.group(2).lower()
        break
    return None, None

species_heads = []
genus_latin = None
for k, (i, kind, text, g) in enumerate(headings):
    if kind == 'genre':
        genus_latin = g; continue
    g_from_line, ep = latin_for(i, text)
    end = headings[k + 1][0] if k + 1 < len(headings) else idx_start
    body = ' '.join(x.strip() for x in lines[i + 1:end])
    body = re.sub(r'¬\s+', '', body)              # hyphenation marks
    body = re.sub(r'\s+', ' ', body).strip()
    species_heads.append({'line': i, 'heading': text, 'genus': genus_latin, 'genus_line': g_from_line,
                          'epithet_body': ep, 'french_body': ' '.join(text.split('.')[0].split()[1:]), 'text_fr': body})

# ---------------------------------------------------------------- 3. align index ↔ body
index.sort(key=lambda e: (e['page'], e['plate']))
unused = list(range(len(species_heads)))
for e in index:
    best, best_s = None, 0
    for h in unused:
        sh = species_heads[h]
        cands = [sh['epithet_body'] or '', sh['french_body'] or '']
        s = max(difflib.SequenceMatcher(None, norm(e['epithet']), norm(c)).ratio() for c in cands)
        s2 = difflib.SequenceMatcher(None, norm(e['french']), norm(sh['french_body'])).ratio()
        s = max(s, s2)
        if s > best_s: best, best_s = h, s
    if best is not None and best_s >= 0.62:
        sh = species_heads[best]; unused.remove(best)
        gl = snap_genus(sh['genus_line']) if sh['genus_line'] else None
        genus = gl if (gl in CANON) else (sh['genus'] or gl)
        e.update({'genus': genus, 'heading': sh['heading'], 'text_fr': sh['text_fr'],
                  'match': round(best_s, 2), 'body_line': sh['line']})
    else:
        e.update({'genus': None, 'heading': None, 'text_fr': '', 'match': round(best_s, 2), 'body_line': None})

# genus for unmatched entries: nearest matched neighbour by page (genera run in page order)
for k, e in enumerate(index):
    if not e['genus']:
        for d in range(1, 12):
            for j in (k - d, k + d):
                if 0 <= j < len(index) and index[j]['genus']:
                    e['genus'] = index[j]['genus']; e['genus_inferred'] = True; break
            if e['genus']: break

for e in index:
    ep = e['epithet'].lower()
    e['latin_1835'] = f"{(e['genus'] or '?').capitalize()} {ep}"

# ---------------------------------------------------------------- 4. assign to cut specimens
plates = json.load(open(os.path.join(ROOT, 'content/book-plates.json')))['plates']
order_to_key = {p['order']: p['plateKey'] for p in plates}
counts = {}
for f in glob.glob(os.path.join(ROOT, 'site/public/plates/*/manifest.json')):
    m = json.load(open(f)); counts[m['plateKey']] = len(m['specimens'])

by_plate = defaultdict(list)
for e in index: by_plate[e['plate']].append(e)
issues = []
for plate, es in sorted(by_plate.items()):
    key = order_to_key.get(plate)
    es.sort(key=lambda e: e['page'])
    for i, e in enumerate(es, 1):
        e['plateKey'] = key
        e['specimen'] = f'{key}-{i}' if key else None
        e['figure_order'] = 'by page order (unverified)'
    if key and counts.get(key) != len(es):
        issues.append(f'plate {plate:2d} ({key}): index lists {len(es)} species, cutter found {counts.get(key)} specimens')

json.dump(index, open(os.path.join(ROOT, 'content/lucas-entries.json'), 'w'), ensure_ascii=False, indent=1)

print(f'index entries: {len(index)}   body species headings: {len(species_heads)}   matched: {sum(1 for e in index if e["heading"])}')
print(f'plates covered: {len(by_plate)}/80   unmatched body headings: {len(unused)}')
print('\nCOUNT MISMATCHES'); print('\n'.join(issues) or 'none')
print('\nLOW-CONFIDENCE / UNMATCHED')
for e in index:
    if not e['heading'] or e['match'] < 0.75:
        print(f"  pl {e['plate']:2d} p{e['page']:3d}  {e['french']:<14} {e['epithet']:<14} -> {e['latin_1835']:<26} match={e['match']}")
