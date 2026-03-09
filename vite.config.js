import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
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
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'PDF-A-go-slim',
        short_name: 'PDF-A-go-slim',
        description: 'Optimize PDFs entirely in your browser — no uploads, no accounts.',
        theme_color: '#c0c0c8',
        background_color: '#c0c0c8',
        display: 'standalone',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        // Precache app shell: JS, CSS, HTML, SVG, WASM
        globPatterns: ['**/*.{js,css,html,svg,wasm}'],
        // Exclude sound files from precache — they're optional and add ~1 MB.
        // They'll be cached on first use via the runtime caching rule below.
        globIgnores: ['**/sounds/**'],
        runtimeCaching: [
          {
            // Cache sound effects on first play
            urlPattern: /\/sounds\/.*\.mp3$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'sound-effects',
              expiration: {
                maxEntries: 30,
              },
            },
          },
        ],
        // Skip waiting and claim clients immediately on update
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
});
