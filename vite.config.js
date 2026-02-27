import { defineConfig } from 'vite';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const now = new Date();
const buildDate = `${now.getDate()} ${now.toLocaleDateString('en-US', { month: 'short' })} ${now.getFullYear()}`;

export default defineConfig({
  define: {
    __BUILD_DATE__: JSON.stringify(buildDate),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
