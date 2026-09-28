// Writes one HTML shell per ready book (site/<route>/index.html) with that book's title, description and
// share image, so a shared book link previews as the book. The shell is index.html with its head tags swapped;
// the app routes by pathname as usual. Run before vite build (see package.json "build").
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const books = JSON.parse(readFileSync(join(root, 'public/books/index.json'), 'utf8')).books.filter(b => b.status === 'ready');
const SITE = 'https://aurelianpress.co.uk';
const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const pages = [];
for (const b of books) {
  const title = `${b.title} · The Aurelian Press`;
  const count = b.volumes ? `${b.volumes.filter(v => v.status === 'ready').length} volumes, ${b.plates} plates, ${b.specimens} ${b.noun}` : `${b.plates} plates, ${b.specimens} ${b.noun}`;
  const desc = `${b.authorLong}’s ${b.title} (${b.place}, ${b.year}), brought to life: ${count}. Scroll the plates; the hand-coloured specimens breathe and can be pinned for their facts.`;
  const url = `${SITE}${b.route}`, img = `${SITE}/og/${b.id}.png`;
  const out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${img}$2`)
    .replace(/(<meta property="og:image:alt" content=")[^"]*(")/, `$1${esc(`A hand-coloured plate from ${b.title}.`)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${img}$2`)
    .replace(/<script type="application\/ld\+json">[^<]*<\/script>/, `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Book', name: b.title, author: { '@type': 'Person', name: b.authorLong }, datePublished: String(b.year).slice(0, 4), locationCreated: b.place, url, image: img, isPartOf: { '@type': 'WebSite', name: 'The Aurelian Press', url: SITE + '/' } })}</script>`);
  const dir = join(root, b.route.slice(1));
  mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'index.html'), out);
  pages.push(b.route);
}
const made = ['/made/', '/made/how-a-book-is-cut/', '/made/the-shelf-and-the-opening/'];   // the "how it's made" pages
const urls = ['/', ...pages, ...made].map(p => `  <url><loc>${SITE}${p}</loc></url>`).join('\n');
writeFileSync(join(root, 'public/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
writeFileSync(join(root, 'public/robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
console.log('prerendered', pages.join(' '));
