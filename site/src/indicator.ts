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

  constructor(private count: number, private labels: (i: number) => string, private onSelect: (i: number) => void,
              private numeral: (i: number) => string = (i) => roman(i + 1), volumeStart: (i: number) => boolean = (i) => i === 0) {
    const ol = document.getElementById('ticks')!; ol.innerHTML = '';
    let sinceStart = 0;
    for (let i = 0; i < count; i++) {
      const li = document.createElement('li');
      li.style.top = `${this.pct(i)}%`;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', `Plate ${this.numeral(i)}`);
      if (volumeStart(i)) { sinceStart = 0; li.classList.add('ten', 'vol'); } else sinceStart++;
      if (sinceStart > 0 && (sinceStart + 1) % 10 === 0) li.classList.add('ten');
      const span = document.createElement('span'); span.textContent = this.labels(i); li.appendChild(span);
      li.addEventListener('click', () => onSelect(i));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i); } });
      ol.appendChild(li); this.ticks.push(li);
    }
    // a volume's first plate carries its own label; the tick just before it stays quiet so the two never collide
    this.ticks.forEach((t, i) => { if (i > 0 && t.classList.contains('vol')) this.ticks[i - 1].classList.remove('ten'); });
  }

  private pct(i: number) { return this.count > 1 ? (i / (this.count - 1)) * 100 : 0; }

  set(i: number) {
    if (i === this.current) return;
    this.current = i;
    this.marker.style.top = `${this.pct(i)}%`;
    this.markerLabel.textContent = this.numeral(i);
    this.ticks.forEach((t, k) => t.classList.toggle('current', k === i));
  }

  /** Refresh tick labels after content (species names) loads. */
  relabel(labels: (i: number) => string) {
    this.labels = labels;
    this.ticks.forEach((t, i) => (t.firstElementChild as HTMLElement).textContent = labels(i));
  }
}
