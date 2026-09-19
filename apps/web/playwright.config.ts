import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const fixtures = resolve(here, '../../fixtures');
const PORT = 5198;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1440, height: 940 }, serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 940 } } }],
  webServer: {
    command: `vite build --outDir dist-e2e && vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      GW_PACKS_DIR: resolve(fixtures, 'packs'),
      VITE_PACK_INDEX_PUBKEY: readFileSync(resolve(fixtures, 'packs/test-key.pub'), 'utf8').trim(),
    },
  },
});
