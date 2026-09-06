import type { Content, SpeciesInfo } from './types';

export function roman(n: number): string {
  const map: [number, string][] = [[100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

let content: Content | null = null;
export async function loadContent(): Promise<Content> {
  if (!content) content = await fetch('/content/plates.json').then(r => r.json());
  return content!;
}
export const getContent = () => content;

export function speciesFor(id: string): SpeciesInfo {
  return content?.specimens[id] ?? {};
}

/** Short label for a plate: the first named species on it, else just the numeral. */
export function plateLabel(plateKey: string, specimenIds: string[]): string {
  const c = content; if (!c) return '';
  const named = specimenIds.map(id => c.specimens[id]).find(s => s?.name || s?.latin);
  const num = roman(c.plates[plateKey].order);
  return named ? `${num} · ${named.name ?? named.latin}` : num;
}
