import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// every ready book gets its own HTML shell (scripts/prerender-meta.mjs) so shared links carry the book's metadata
const books = JSON.parse(readFileSync(resolve(__dirname, 'public/books/index.json'), 'utf8')).books.filter((b: any) => b.status === 'ready');
const input: Record<string, string> = { main: resolve(__dirname, 'index.html') };
for (const b of books) input[b.id] = resolve(__dirname, b.route.slice(1), 'index.html');

export default defineConfig({
  build: { target: 'esnext', rollupOptions: { input } },      // the entry awaits at top level
});
