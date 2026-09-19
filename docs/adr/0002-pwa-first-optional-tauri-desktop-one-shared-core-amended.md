# ADR-0002: PWA first, optional Tauri desktop, one shared core (amended)

- **Status:** Proposed (Amended (D1))
- **Reversal cost:** High
- **Source:** docs/Core architecture.md

- **Context:** Trust is the adoption barrier. A web app reloads its code from the host on every visit; a signed desktop binary doesn't. Whole-genome VCFs are too large for the browser.
- **Decision:** Ship a TypeScript PWA first. Keep all domain logic in a shared Rust core and storage behind one adapter, so a Tauri desktop shell can follow without a rewrite.
- **Consequences:** Reach now; verifiable offline builds and WGS support later. Cost: a storage abstraction and, later, a second release pipeline.
- **Rejected:** Browser-only PWA, no backend, for good (can't prove code integrity, can't hold WGS); desktop-only (loses reach); any server that touches genetic data (fails the privacy must).
