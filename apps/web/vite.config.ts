import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { cpSync, createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../..');

/**
 * The app's own version, from the root package.json.
 *
 * Deliberately not the locus version: that one is stamped on every kit and
 * pack at import time to record which normalizer produced those calls, so it
 * moves only when crates/locus does. Two numbers, two meanings.
 */
const appVersion = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version as string;
const packsDir = process.env.GW_PACKS_DIR ? resolve(process.env.GW_PACKS_DIR) : join(repo, 'packs-dist');

/**
 * Content Security Policy (principle 1): the app may only talk to its own
 * origin. Sent as a header so it also binds the workers, and repeated as a
 * meta tag in index.html for static hosting.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  // The only host any plugin may ever reach: AlphaFold, for one structure file
  // per protein, and only after the user grants it (Plugin Host).
  "connect-src 'self' https://alphafold.ebi.ac.uk",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Serve packs-dist/ at /packs/ (the same-origin Pack Index) and ship it with the build. */
function packIndex(): Plugin {
  const serve = (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/packs/')) return next();
    const file = join(packsDir, decodeURIComponent(req.url.slice('/packs/'.length).split('?')[0]!));
    if (!file.startsWith(packsDir) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader('Content-Length', statSync(file).size);
    res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'gw-pack-index',
    configureServer: (server) => void server.middlewares.use(serve),
    configurePreviewServer: (server) => void server.middlewares.use(serve),
    writeBundle(options) {
      const out = options.dir ?? resolve(import.meta.dirname, 'dist');
      if (existsSync(join(packsDir, 'index.json'))) cpSync(packsDir, join(out, 'packs'), { recursive: true, filter: (f) => !f.endsWith('.pem') });
    },
  };
}

const headers = {
  'Content-Security-Policy': CSP,
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    svelte(),
    packIndex(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,woff2,svg}'],
        globIgnores: ['packs/**'],
        maximumFileSizeToCacheInBytes: 64 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/packs\//],
      },
      manifest: {
        name: 'Genotype Workbench',
        short_name: 'Workbench',
        description: 'Explore your own raw DNA file on this device.',
        theme_color: '#161826',
        background_color: '#161826',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    }),
  ],
  server: { headers, fs: { allow: [repo] } },
  preview: { headers },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm', '@gw/locus-wasm'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
