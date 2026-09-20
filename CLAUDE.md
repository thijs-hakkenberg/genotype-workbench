# Genotype Workbench

Local-first genotype workbench. Read README.md for layout and commands; docs/ holds the architecture, decisions and ADRs. They are the source of truth for design choices.

## Rules that are easy to break

- Never commit or copy a real raw genotype file into the repo. Tests use `fixtures/synthetic-kits/`. A real file may be used locally from its own location only.
- Normalization lives only in `crates/locus` (plugins may translate; only the core normalizes). The WASM and Python bindings wrap it; don't reimplement allele logic in TS or Python.
- rsID is a lookup, never a join key. Joins are on (chrom, pos) plus allele.
- No runtime network access except through `PluginHost.fetch` with a grant. CSP is `connect-src 'self' https://alphafold.ebi.ac.uk` — the outer bound; the grant is the gate. Adding a host means changing both vite.config.ts and index.html, and saying why in an ADR. DuckDB extension autoloading stays off. New DuckDB extensions must be vendored in `scripts/vendor-duckdb-extensions.mjs` with a pinned hash.
- UI wording follows docs/…/Genotype Workbench UI.dc.html section 06: "differs from the GRCh37 reference", "ClinVar classification", associations are "not a statement about you", no risk numbers, every annotation cites source + pack version + licence.
- The app version and the locus version are different numbers, and syncing them would be a lie. The app version lives in the root `package.json` and reaches the UI as `__APP_VERSION__`. `locusVersion` comes from `crates/locus` and is stamped on every kit and pack at import to record which normalizer produced those calls, so it moves only when that crate does.
- Evidence kinds are encoded by form, not colour (plugins/view-tracks/src/marks). Use Nocturne tokens only (apps/web/src/styles/nocturne.css is a copy; don't edit it).

## Commands

- `pnpm dev`: builds WASM + DuckDB extensions, runs the app on Vite
- `pnpm test`: cargo tests (incl. golden file, `UPDATE_GOLDEN=1` to update on purpose) + vitest
- `pnpm test:e2e`: Playwright against a production build with fixture packs
- `pnpm check`: svelte-check
- `pnpm packs:build [--only …]`: pack pipeline; `packkit fixtures` re-cuts test packs after pack schema changes
