import type { Content, SpeciesInfo } from './types';

export function roman(n: number): string {
  const map: [number, string][] = [[100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

/** Content is loaded per volume root; plate keys repeat between volumes, so callers say which root. */
const contents = new Map<string, Content>();
export async function loadContent(root: string): Promise<Content> {
  let c = contents.get(root);
  if (!c) { c = await fetch(`${root}/content/plates.json`).then(r => r.json()); contents.set(root, c!); }
  return c!;
}
export function clearContent() { contents.clear(); }
export const getContent = (root: string) => contents.get(root);

export function speciesFor(root: string, id: string): SpeciesInfo {
  return contents.get(root)?.specimens[id] ?? {};
}

/** Short label for a plate: the first named species on it, else just the numeral. */
export function plateLabel(root: string, plateKey: string, specimenIds: string[]): string {
  const c = contents.get(root); if (!c) return '';
  const named = specimenIds.map(id => c.specimens[id]).find(s => s?.name || s?.latin);
  const num = roman(c.plates[plateKey].order);
  return named ? `${num} · ${named.name ?? named.latin}` : num;
}
