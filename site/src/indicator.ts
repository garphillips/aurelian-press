import { roman } from './content';

/**
 * Vertical ruler on the right edge: one tick per plate, a longer labelled tick every
 * ten, and a diamond marker that slides to the current plate. Ticks are clickable.
 */
export class Indicator {
  private ticks: HTMLLIElement[] = [];
  private marker = document.getElementById('marker')!;
  private markerLabel = document.getElementById('markerLabel')!;
  private current = -1;

  constructor(private count: number, private labels: (i: number) => string, private onSelect: (i: number) => void) {
    const ol = document.getElementById('ticks')!;
    for (let i = 0; i < count; i++) {
      const li = document.createElement('li');
      li.style.top = `${this.pct(i)}%`;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', `Plate ${roman(i + 1)}`);
      if ((i + 1) % 10 === 0 || i === 0) li.classList.add('ten');
      const span = document.createElement('span'); span.textContent = this.labels(i); li.appendChild(span);
      li.addEventListener('click', () => onSelect(i));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i); } });
      ol.appendChild(li); this.ticks.push(li);
    }
  }

  private pct(i: number) { return this.count > 1 ? (i / (this.count - 1)) * 100 : 0; }

  set(i: number) {
    if (i === this.current) return;
    this.current = i;
    this.marker.style.top = `${this.pct(i)}%`;
    this.markerLabel.textContent = roman(i + 1);
    this.ticks.forEach((t, k) => t.classList.toggle('current', k === i));
  }

  /** Refresh tick labels after content (species names) loads. */
  relabel(labels: (i: number) => string) {
    this.labels = labels;
    this.ticks.forEach((t, i) => (t.firstElementChild as HTMLElement).textContent = labels(i));
  }
}
