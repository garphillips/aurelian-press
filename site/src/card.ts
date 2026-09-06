import { getContent, roman, speciesFor } from './content';
import type { Specimen } from './specimen';

/** The pinned specimen's letterpress card. Content comes from /content/plates.json. */
export class Card {
  el = document.getElementById('card')!;
  private num = document.getElementById('cNum')!;
  private name = document.getElementById('cName')!;
  private latin = document.getElementById('cLatin')!;
  private meta = document.getElementById('cMeta')!;
  private facts = document.getElementById('cFacts')!;
  private src = document.getElementById('cSrc')!;

  constructor(onClose: () => void, private unreadNote = 'The caption for this figure has not been read yet. Its species and facts will follow.') {
    this.el.querySelector('.close')!.addEventListener('click', (e) => { e.stopPropagation(); onClose(); });
  }

  show(sp: Specimen, plateKey: string, root: string) {
    const c = getContent(root);
    const plate = c?.plates[plateKey];
    const info = speciesFor(root, sp.m.id);
    const fig = info.figure ?? parseInt(sp.m.id.split('-')[1]);
    const numeral = roman(plate?.order ?? 0);
    this.num.textContent = `Plate ${numeral} · figure ${fig}`;
    this.name.textContent = info.name ?? info.latin ?? `Figure ${fig}`;
    this.latin.textContent = info.name ? (info.latin ?? '') : (info.caption ?? '');
    this.meta.innerHTML = '';
    for (const [k, v] of [['Family', info.family], ['Wingspan', info.wingspan], ['Range', info.range], ['Flies', info.flies]] as const) {
      if (!v) continue;
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      this.meta.append(dt, dd);
    }
    this.facts.innerHTML = '';
    for (const f of info.facts ?? []) { const li = document.createElement('li'); li.textContent = f; this.facts.appendChild(li); }
    if (!info.name && !info.latin) {
      const li = document.createElement('li');
      li.textContent = this.unreadNote;
      this.facts.appendChild(li);
    } else if (info.confidence === 'probable') {
      const li = document.createElement('li'); li.style.fontStyle = 'italic';
      li.textContent = 'Identification read from the plate’s handwritten caption; to be confirmed.';
      this.facts.appendChild(li);
    }
    this.src.innerHTML = plate
      ? `From <i>${c!.book.title}</i>, ${c!.book.years}. <a href="${plate.bhlUrl}" target="_blank" rel="noopener">Original plate</a> · <a href="${plate.flickrUrl}" target="_blank" rel="noopener">${plate.flickrUrl.includes('flickr') ? 'Flickr' : 'Scan'}</a>`
      : '';
    this.el.classList.add('show');
  }

  hide() { this.el.classList.remove('show'); }

  /** Place the card to the right of a screen point, clamped to the viewport. */
  placeAt(x: number, y: number) {
    if (innerWidth <= 640) return;
    this.el.style.left = `${Math.min(innerWidth - this.el.offsetWidth - 72, Math.max(24, x))}px`;
    this.el.style.top = `${Math.min(innerHeight - this.el.offsetHeight - 24, Math.max(24, y))}px`;
  }
}
