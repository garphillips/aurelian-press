/** The shelf configuration: every book the site knows about, from /books/index.json. */
export interface BookConfig {
  id: string;
  route: string;                 // e.g. "/lucas/"
  series?: string;               // books in a series share a binding
  volume?: number;
  volumes?: { n: number; status: 'ready' | 'coming' }[];   // a multi-volume work read as one book
  title: string; shortTitle: string;
  author: string; authorLong: string;
  place: string; year: string;
  plates?: number; specimens?: number; noun: string;
  status: 'ready' | 'coming';
  format: { h: number; w: number; d: number };   // world units: height, width (spine to fore-edge), thickness
  cloth: string; gilt: string;   // binding colour (spine, edges) and the gilt
  spineTitle?: string;           // gilt along the spine; the year goes at the foot
  spine?: string[][];            // older style: gilt panels, each a stack of lines
  cover?: { front: string; frontMr?: string; grain?: string };   // photographs of the real binding
  portrait?: { image: string; caption: string; dates?: string };   // the author, as a frontispiece under the cover
  masthead?: string; credit?: string; unreadNote?: string;
}

let books: BookConfig[] | null = null;
export async function loadBooks(): Promise<BookConfig[]> {
  if (!books) books = (await fetch('/books/index.json').then(r => r.json())).books;
  return books!;
}

/** Content root for a book's plates and cards. */
export const bookBase = (b: BookConfig) => `/books/${b.id}`;

/** The volumes to read, each with its content root; a single-volume book is one unnumbered volume. */
export function volumesOf(b: BookConfig): { n: number; status: 'ready' | 'coming'; root: string }[] {
  if (!b.volumes) return [{ n: 0, status: 'ready', root: bookBase(b) }];
  return b.volumes.map(v => ({ ...v, root: `${bookBase(b)}/${v.n}` }));
}

/** Which book a pathname opens, if any. */
export function bookForPath(list: BookConfig[], pathname: string): BookConfig | undefined {
  const p = pathname.endsWith('/') ? pathname : pathname + '/';
  return list.find(b => b.route === p);
}

export const romanVol = (n: number) => ['', 'I', 'II', 'III', 'IV', 'V', 'VI'][n] ?? String(n);
