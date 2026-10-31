import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site from https://mipho.github.io/mipho-maps/ — must match the repo name.
  base: '/mipho-maps/',
  root: '.',
  build: {
    outDir: 'dist',
  },
});
