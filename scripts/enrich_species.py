"""
Enrich Lucas's 1835 names with modern taxonomy and reference data.

For each entry in content/lucas-entries.json:
  GBIF      /species/match on "Genus epithet" -> accepted name, family, status
            fallback: /species/search by epithet within Lepidoptera, ranked by name similarity
  Wikipedia REST summary for the accepted name (title, extract, url)
            + wikitext scan for a wingspan in mm/cm
  Wikidata  English common name (P1843) when Wikipedia has none

Results are cached per query in assets-src/text/cache/ so re-runs are cheap.
Output: content/species-auto.json keyed by specimen id (e.g. "n16-1").
"""
import json, os, re, time, hashlib, difflib, sys, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'assets-src/text/cache'); os.makedirs(CACHE, exist_ok=True)
UA = 'LepidopteraPlates/0.1 (gareth.phillips@carwow.co.uk)'
LEPIDOPTERA_KEY = 797
DELAY = 0.12

def get(url):
    h = hashlib.md5(url.encode()).hexdigest()
    fp = os.path.join(CACHE, h + '.json')
    if os.path.exists(fp):
        return json.load(open(fp))
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode('utf-8'))
    except Exception as ex:  # cache failures too so we don't hammer
        data = {'_error': str(ex)}
    json.dump(data, open(fp, 'w'))
    time.sleep(DELAY)
    return data

def q(s): return urllib.parse.quote(s)

# ------------------------------------------------------------------ GBIF
def gbif_match(name):
    return get(f'https://api.gbif.org/v1/species/match?name={q(name)}&kingdom=Animalia')

def gbif_search_epithet(epithet):
    d = get(f'https://api.gbif.org/v1/species/search?q={q(epithet)}&rank=SPECIES&highertaxonKey={LEPIDOPTERA_KEY}&status=ACCEPTED&limit=40')
    return d.get('results', [])

def gbif_usage(key):
    return get(f'https://api.gbif.org/v1/species/{key}')

def gbif_vernacular(key):
    d = get(f'https://api.gbif.org/v1/species/{key}/vernacularNames?limit=50')
    names = [v['vernacularName'] for v in d.get('results', []) if v.get('language') == 'eng']
    # most common first
    return sorted(set(names), key=lambda n: -names.count(n))

def resolve(latin_1835, epithet):
    """Return dict with accepted taxon info + how sure we are."""
    out = {'query': latin_1835, 'candidates': []}
    m = gbif_match(latin_1835)
    ok = m.get('matchType') in ('EXACT', 'FUZZY') and m.get('rank') in ('SPECIES', 'SUBSPECIES') and m.get('confidence', 0) >= 80
    if ok:
        key = m.get('acceptedUsageKey') or m.get('usageKey')
        u = gbif_usage(key)
        out.update({'method': 'match', 'gbif_confidence': m.get('confidence'), 'matchType': m.get('matchType'),
                    'synonym_of_1835_name': m.get('status') == 'SYNONYM', 'matched_1835_as': m.get('scientificName')})
    else:
        # search by epithet within Lepidoptera, allow OCR damage via fuzzy ratio on the epithet
        cands = gbif_search_epithet(epithet)
        scored = []
        for c in cands:
            cn = c.get('canonicalName', '')
            if ' ' not in cn: continue
            ep = cn.split()[-1].lower()
            r = difflib.SequenceMatcher(None, ep, epithet.lower()).ratio()
            scored.append((r, c))
        scored.sort(key=lambda x: -x[0])
        out['candidates'] = [{'name': c.get('scientificName'), 'family': c.get('family'), 'key': c.get('key'), 'score': round(r, 2)} for r, c in scored[:5]]
        if scored and scored[0][0] >= 0.9:
            u = gbif_usage(scored[0][1]['key']); out.update({'method': 'epithet-search', 'gbif_confidence': int(scored[0][0] * 100)})
        else:
            out.update({'method': 'none', 'gbif_confidence': 0}); return out
    out.update({'accepted': u.get('canonicalName'), 'accepted_authorship': u.get('authorship'), 'family': u.get('family'),
                'genus': u.get('genus'), 'gbif_key': u.get('key'), 'rank': u.get('rank')})
    out['common_names'] = gbif_vernacular(u.get('key'))[:4]
    return out

# ------------------------------------------------------------------ Wikipedia / Wikidata
def wiki_summary(title):
    d = get(f'https://en.wikipedia.org/api/rest_v1/page/summary/{q(title.replace(" ", "_"))}')
    if d.get('type') == 'standard' or d.get('extract'):
        return {'title': d.get('title'), 'extract': d.get('extract'), 'url': d.get('content_urls', {}).get('desktop', {}).get('page')}
    return None

WING_RE = re.compile(r'wingspan[^.\n|]{0,80}?(\d{2,3})(?:\s*(?:–|-|to|and)\s*(\d{2,3}))?\s*(mm|millimet|cm)', re.I)
def wiki_wingspan(title):
    d = get(f'https://en.wikipedia.org/w/api.php?action=parse&page={q(title)}&prop=wikitext&format=json&redirects=1')
    txt = d.get('parse', {}).get('wikitext', {}).get('*', '') if isinstance(d, dict) else ''
    m = WING_RE.search(txt)
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

# ------------------------------------------------------------------ main
entries = json.load(open(os.path.join(ROOT, 'content/lucas-entries.json'), encoding='utf-8'))
out = {}
for i, e in enumerate(entries):
    sid = e.get('specimen')
    if not sid: continue
    epithet = re.sub(r"[^a-zA-Zœ]", '', e['epithet']).replace('œ', 'oe')
    latin = f"{(e['genus'] or '').capitalize()} {epithet}".strip()
    r = resolve(latin, epithet)
    rec = {'specimen': sid, 'plate': e['plate'], 'page': e['page'], 'french_1835': e['french'], 'latin_1835': latin,
           'lucas_heading': e.get('heading'), 'text_fr': e.get('text_fr', ''), 'taxonomy': r}
    if r.get('accepted'):
        ws = wiki_summary(r['accepted']) or (wiki_summary(latin) if latin != r['accepted'] else None)
        rec['wikipedia'] = ws
        rec['wingspan'] = wiki_wingspan(ws['title']) if ws else None
        common = r.get('common_names') or []
        if not common: common = wikidata_common(r['accepted'])
        rec['common_names'] = common
    # review flags
    flags = []
    if r.get('method') == 'none': flags.append('no taxon match')
    elif r.get('method') == 'epithet-search': flags.append('genus taken from GBIF search, check')
    if e.get('match', 1) < 0.75: flags.append('weak index↔text match')
    if e.get('genus_inferred'): flags.append('genus inferred from neighbours')
    if not rec.get('wikipedia'): flags.append('no Wikipedia page')
    rec['flags'] = flags
    rec['confidence'] = 'high' if not flags else ('medium' if 'no taxon match' not in flags else 'low')
    out[sid] = rec
    print(f"{i+1:3d}/{len(entries)} {sid:8s} {latin:26s} -> {r.get('accepted') or '—':28s} {r.get('family') or '':14s} {','.join(flags)}", flush=True)

json.dump(out, open(os.path.join(ROOT, 'content/species-auto.json'), 'w'), ensure_ascii=False, indent=1)
hi = sum(1 for v in out.values() if v['confidence'] == 'high'); md = sum(1 for v in out.values() if v['confidence'] == 'medium')
print(f"\nwrote {len(out)} records: {hi} high, {md} medium, {len(out)-hi-md} low confidence")
