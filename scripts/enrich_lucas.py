"""
Enrich Lucas's 1835 names with modern taxonomy and reference data (corrected resolver, ported from
the British Moths fork).

For each entry in content/lucas-entries.json (genus + epithet as parsed from the index and body text):
  GBIF      match on "Genus epithet" with the epithet lower-cased (GBIF reads a capitalised epithet as a genus)
            fallback 1: match the genus alone (fuzzy), then fuzzy-match the epithet stem against every species
                        in that genus (children list + text search)
            fallback 2: same inside the genus's family with a stricter threshold
  Wikipedia REST summary for the accepted name; wikitext scan for wingspan (plain or {{convert}} template)
  Wikidata  English common name (P1843) when GBIF has none
Cached per URL in assets-src/text/cache/. Output: content/species-auto.json keyed by specimen id ("n16-1").
"""
import json, os, re, time, hashlib, difflib, urllib.parse, urllib.request, unicodedata
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'assets-src/text/cache'); os.makedirs(CACHE, exist_ok=True)
UA = 'LepidopteraPlates/0.1 (gareth.phillips@carwow.co.uk)'
DELAY = 0.1

def get(url):
    fp = os.path.join(CACHE, hashlib.md5(url.encode()).hexdigest() + '.json')
    if os.path.exists(fp):
        d = json.load(open(fp))
        if '_error' not in d: return d
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: data = json.loads(r.read().decode('utf-8'))
    except Exception as ex: data = {'_error': str(ex)}
    json.dump(data, open(fp, 'w')); time.sleep(DELAY)
    return data
q = urllib.parse.quote

def gbif_match(name, rank=None):
    return get(f'https://api.gbif.org/v1/species/match?name={q(name)}&kingdom=Animalia' + (f'&rank={rank}' if rank else ''))
def gbif_usage(key): return get(f'https://api.gbif.org/v1/species/{key}')
def gbif_vernacular(key):
    d = get(f'https://api.gbif.org/v1/species/{key}/vernacularNames?limit=60')
    names = [v['vernacularName'] for v in d.get('results', []) if v.get('language') == 'eng']
    return sorted(set(names), key=lambda n: -names.count(n))
def gbif_search_in(taxon_key, epithet, limit=40):
    d = get(f'https://api.gbif.org/v1/species/search?q={q(epithet)}&highertaxonKey={taxon_key}&rank=SPECIES&limit={limit}')
    return d.get('results', [])
def gbif_children(key):
    return [c for c in get(f'https://api.gbif.org/v1/species/{key}/children?limit=400').get('results', []) if c.get('rank') == 'SPECIES']

def stem(ep): return re.sub(r'(us|um|is|ae|ii|a|e|i)$', '', ep)
def best_in(results, epithet, threshold):
    scored = []
    for c in results:
        cn = c.get('canonicalName') or ''
        if ' ' not in cn or c.get('order') not in (None, 'Lepidoptera'): continue   # GBIF search ignores highertaxonKey at times
        scored.append((difflib.SequenceMatcher(None, stem(cn.split()[1].lower()), stem(epithet)).ratio(), c))
    scored.sort(key=lambda x: -x[0])
    cands = [{'name': c.get('scientificName'), 'status': c.get('taxonomicStatus'), 'family': c.get('family'), 'score': round(r, 2)} for r, c in scored[:4]]
    if scored and scored[0][0] >= threshold:
        top = scored[0][0]
        accepted = {(c.get('acceptedKey') or c.get('key')) for r, c in scored if r >= top - 0.02}
        if len(accepted) > 1:                       # several different species share this epithet: don't guess
            return None, [{**cd, 'ambiguous': True} for cd in cands], top
        c = scored[0][1]; return (c.get('acceptedKey') or c.get('key')), cands, top
    return None, cands, (scored[0][0] if scored else 0)

def resolve(genus, epithet):
    genus = re.sub(r'[^A-Za-z]', '', genus or '').capitalize()
    ep = (epithet or '').lower().replace('œ', 'oe').replace('æ', 'ae')
    ep = ''.join(c for c in unicodedata.normalize('NFD', ep) if unicodedata.category(c) != 'Mn')   # agapénor -> agapenor
    ep = re.sub(r'[^a-z]', '', ep)
    out = {'query': f'{genus} {ep}', 'candidates': [], 'method': 'none', 'gbif_confidence': 0}
    if len(genus) < 3 or len(ep) < 3: return out
    key = None
    variants = [ep] + [ep[:i] + 'c' + ep[i+1:] for i, ch in enumerate(ep) if ch == 'o'][:4]
    for v in dict.fromkeys(variants):
        m = gbif_match(f'{genus} {v}')
        if m.get('matchType') in ('EXACT', 'FUZZY') and m.get('rank') in ('SPECIES', 'SUBSPECIES') and m.get('confidence', 0) >= 80:
            key = m.get('acceptedUsageKey') or m.get('usageKey')
            out.update(method='match', gbif_confidence=m.get('confidence'), matchType=m.get('matchType'), ocr_variant=v if v != ep else None,
                       synonym_of_1835_name=m.get('status') == 'SYNONYM', matched_1835_as=m.get('scientificName'))
            break
    if not key:
        g = gbif_match(genus, rank='GENUS')
        if g.get('rank') == 'GENUS' and g.get('confidence', 0) >= 80:
            out['genus_resolved'] = g.get('canonicalName'); out['genus_family'] = g.get('family')
            gkey = g.get('acceptedUsageKey') or g['usageKey']
            key, cands, sc = best_in(gbif_search_in(gkey, ep) + gbif_children(gkey), ep, 0.72)
            out['candidates'] = cands
            if key: out.update(method='genus-search', gbif_confidence=int(sc * 100))
            elif g.get('familyKey'):
                key, cands, sc = best_in(gbif_search_in(g['familyKey'], ep, 60), ep, 0.9)
                out['candidates'] = cands or out['candidates']
                if key: out.update(method='family-search', gbif_confidence=int(sc * 100))
    if not key:
        # Lucas's genera are mostly obsolete (Pieris -> Delias/Appias, Nymphalis -> Charaxes/Adelpha ...): as a last
        # resort search the epithet across all butterflies (Papilionoidea) and accept only a near-exact stem match
        pk = gbif_match('Papilionoidea', rank='SUPERFAMILY').get('usageKey')
        if pk:
            key, cands, sc = best_in(gbif_search_in(pk, ep, 80), ep, 0.93)
            out['candidates'] = cands or out['candidates']
            if key: out.update(method='butterfly-search', gbif_confidence=int(sc * 100))
    if not key: return out
    u = gbif_usage(key)
    if u.get('order') and u.get('order') != 'Lepidoptera': out['method'] = 'none'; out['rejected'] = u.get('canonicalName'); return out
    if u.get('rank') == 'SUBSPECIES' and u.get('speciesKey'):
        u = gbif_usage(u['speciesKey']); key = u.get('key')
    out.update(accepted=u.get('canonicalName'), accepted_authorship=u.get('authorship'), family=u.get('family'),
               genus=u.get('genus'), gbif_key=key, rank=u.get('rank'), common_names=gbif_vernacular(key)[:4])
    return out

def wiki_summary(title):
    d = get(f'https://en.wikipedia.org/api/rest_v1/page/summary/{q(title.replace(" ", "_"))}')
    if d.get('type') == 'standard' and d.get('extract'):
        return {'title': d.get('title'), 'extract': d.get('extract'), 'url': d.get('content_urls', {}).get('desktop', {}).get('page')}
    return None
def wiki_wikitext(title):
    d = get(f'https://en.wikipedia.org/w/api.php?action=parse&page={q(title)}&prop=wikitext&format=json&redirects=1')
    return d.get('parse', {}).get('wikitext', {}).get('*', '') if isinstance(d, dict) else ''
WING_RE = re.compile(r'wingspan[^.\n|]{0,80}?(\d{2,3})(?:\s*(?:–|-|to|and)\s*(\d{2,3}))?\s*(mm|millimet|cm)', re.I)
CONVERT_RE = re.compile(r'wingspan[^{]{0,80}?\{\{convert\|(\d{2,3})(?:\|(?:-|–|to|and)\|(\d{2,3}))?\|(mm|cm)', re.I)
def wingspan_from(txt):
    m = CONVERT_RE.search(txt) or WING_RE.search(txt)
    if not m: return None
    lo, hi, unit = int(m.group(1)), (int(m.group(2)) if m.group(2) else None), m.group(3).lower()
    if unit.startswith('cm'): lo, hi = lo * 10, (hi * 10 if hi else None)
    return f'{lo}–{hi} mm' if hi else f'{lo} mm'
def wikidata_common(name):
    d = get(f'https://www.wikidata.org/w/api.php?action=wbsearchentities&search={q(name)}&language=en&type=item&format=json')
    for hit in d.get('search', [])[:2]:
        ent = get(f'https://www.wikidata.org/wiki/Special:EntityData/{hit["id"]}.json')
        claims = ent.get('entities', {}).get(hit['id'], {}).get('claims', {})
        names = [c['mainsnak']['datavalue']['value']['text'] for c in claims.get('P1843', [])
                 if c.get('mainsnak', {}).get('datavalue', {}).get('value', {}).get('language') == 'en']
        if names: return names[:3]
    return []

entries = json.load(open(os.path.join(ROOT, 'content/lucas-entries.json'), encoding='utf-8'))
ovr_path = os.path.join(ROOT, 'content/taxonomy-overrides.json')
OVR = {k: v for k, v in json.load(open(ovr_path, encoding='utf-8')).items() if not k.startswith('_')} if os.path.exists(ovr_path) else {}
out = {}
for i, e in enumerate(entries):
    sid = e.get('specimen')
    if not sid: continue
    ov = OVR.get((e.get('latin_1835') or '').lower())
    if ov:
        g, ep = ov[0].split()[0], ov[0].split()[1]
        r = resolve(g, ep); r['method'] = 'manual' if r.get('accepted') else r['method']; r['manual_confidence'] = ov[1]
    else:
        r = resolve(e.get('genus'), e.get('epithet'))
    rec = {'specimen': sid, 'plate': e['plate'], 'page': e['page'], 'french_1835': e['french'], 'latin_1835': e.get('latin_1835'),
           'lucas_heading': e.get('heading'), 'taxonomy': r}
    ws = wiki_summary(r['accepted']) if r.get('accepted') else None
    rec['wikipedia'] = ws
    rec['wingspan'] = wingspan_from(wiki_wikitext(ws['title'])) if ws else None
    common = r.get('common_names') or []
    if not common and r.get('accepted'): common = wikidata_common(r['accepted'])
    rec['common_names'] = common
    flags = []
    if r['method'] == 'none': flags.append('ambiguous: several species share this epithet' if any(c.get('ambiguous') for c in r.get('candidates', [])) else 'no taxon match')
    elif r['method'] in ('genus-search', 'family-search', 'butterfly-search'): flags.append(f"matched by {r['method']} ({r['gbif_confidence']}%), check")
    if e.get('match', 1) < 0.75: flags.append('weak index↔text match')
    if e.get('genus_inferred'): flags.append('genus inferred from neighbours')
    if not ws: flags.append('no Wikipedia page')
    rec['flags'] = flags
    rec['confidence'] = 'low' if r['method'] == 'none' else ('high' if (r['method'] == 'match' or (r['method'] == 'manual' and r.get('manual_confidence') == 'high')) and ws else 'medium')
    out[sid] = rec
    print(f"{i+1:3d}/{len(entries)} {sid:8s} {rec['latin_1835'] or '':26s} -> {r.get('accepted') or '—':28s} {r.get('family') or '':12s} {r['method']:14s} {','.join(flags)}", flush=True)

json.dump(out, open(os.path.join(ROOT, 'content/species-auto.json'), 'w'), ensure_ascii=False, indent=1)
print('\nconfidence:', dict(Counter(v['confidence'] for v in out.values())), ' methods:', dict(Counter(v['taxonomy']['method'] for v in out.values())))
