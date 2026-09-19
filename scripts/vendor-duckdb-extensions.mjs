// Vendors the DuckDB-WASM extensions the app needs into apps/web/public, so
// they load from the app's own origin (CSP connect-src 'self', principle 1).
// This DuckDB-WASM build does not include Parquet; without this step every
// read_parquet fails. Hashes are pinned: a changed file fails the build.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DUCKDB = 'v1.5.4'; // core version inside @duckdb/duckdb-wasm 1.33.1-dev57.0 (SELECT library_version FROM pragma_version())
const PINNED = {
  'wasm_eh/parquet': '4845705bbd69fc9ad52878d96a505c73cae4a6c509822079cc2413e5eb437f95',
  'wasm_mvp/parquet': 'b64c255a7f7d06cc234535b2f0ecab345fda91bffff5509d3179004bc13aa19a',
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps/web/public/duckdb-extensions', DUCKDB);
for (const [key, sha] of Object.entries(PINNED)) {
  const out = join(root, `${key}.duckdb_extension.wasm`);
  const ok = (b) => createHash('sha256').update(b).digest('hex') === sha;
  if (existsSync(out) && ok(readFileSync(out))) continue;
  const url = `https://extensions.duckdb.org/${DUCKDB}/${key}.duckdb_extension.wasm`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!ok(bytes)) throw new Error(`${url}: SHA-256 does not match the pinned hash`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  console.log(`vendored ${key} (${(bytes.length / 1e6).toFixed(1)} MB)`);
}
