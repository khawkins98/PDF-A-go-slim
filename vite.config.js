import { defineConfig } from 'vite';

export default defineConfig({
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
