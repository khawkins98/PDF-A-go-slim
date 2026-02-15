import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/PDF-A-go-slim/' : '/',
  server: {
    open: true,
  },
  build: {
    target: 'es2020',
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
  },
});
