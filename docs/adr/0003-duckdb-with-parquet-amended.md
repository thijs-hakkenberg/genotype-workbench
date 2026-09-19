# ADR-0003: DuckDB with Parquet (amended)

- **Status:** Proposed (Amended (D1))
- **Reversal cost:** Medium
- **Source:** docs/Core architecture.md

- **Decision:** DuckDB as the query engine: WASM in the browser, native in Tauri. Kits and packs are Parquet files, in OPFS in the browser and on disk on the desktop. Queries return Arrow.
- **Consequences:** Same SQL in both shells; packs are plain Parquet, easy to build in CI. Several MB of bundle. The Safari/iOS OPFS spike decides whether phones are supported.
