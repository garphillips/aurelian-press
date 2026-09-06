import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'esnext' },      // the entry awaits at top level
});
