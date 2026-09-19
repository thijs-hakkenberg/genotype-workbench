# ADR-0007: Annotation packs, no per-variant remote lookups (amended)

- **Status:** Proposed (Amended)
- **Reversal cost:** Medium
- **Source:** docs/Core architecture.md

- **Decision:** Enrichment only through whole packs: Parquet + manifest (source, build, version, licence, SHA-256, **scientific domain**, **evidence kind**), downloaded in full from the Pack Index and joined locally. The Content Security Policy blocks all other outbound requests.
- **Consequences:** Querying a remote API per variant would reveal which variants a user carries; whole packs don't. gnomAD must be pre-filtered to chip loci.
