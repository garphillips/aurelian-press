import { defineConfig } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// every ready book gets its own HTML shell (scripts/prerender-meta.mjs) so shared links carry the book's metadata
const books = JSON.parse(readFileSync(resolve(__dirname, 'public/books/index.json'), 'utf8')).books.filter((b: any) => b.status === 'ready');
const input: Record<string, string> = { main: resolve(__dirname, 'index.html') };
for (const b of books) input[b.id] = resolve(__dirname, b.route.slice(1), 'index.html');

// static pages under public/ (the "how it's made" series) live at directory URLs; Pages serves their index.html,
// the dev server would fall through to the SPA shell, so resolve them here
const publicDirs = () => ({
  name: 'public-dir-index',
  configureServer(server: any) {
    server.middlewares.use((req: any, _res: any, next: any) => {
      const path = (req.url ?? '').split('?')[0];
      if (path.endsWith('/') && path !== '/' && existsSync(resolve(__dirname, 'public', path.slice(1), 'index.html'))) req.url = path + 'index.html';
      next();
    });
  },
});

export default defineConfig({
  plugins: [publicDirs()],
  build: { target: 'esnext', rollupOptions: { input } },      // the entry awaits at top level
});
