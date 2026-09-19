# ADR-0006: Plugin contract (amended)

- **Status:** Proposed (Amended (B2, B3, B5))
- **Reversal cost:** High
- **Source:** docs/Core architecture.md

- **Decision:** Five capabilities: `importer`, `annotation-pack`, `view`, `connector`, `analysis`. Consumer chip formats are declarative format profiles the core reads, so no third-party code runs for them; code importers emit `RawCall` rows and the core normalizes. Plugins call a typed Track/Region API with grants scoped by kit, region, track kind and network host. No plugin gets SQL.
- **Consequences:** The storage schema stays private and can change. Isolation: logic in Web Workers, views in sandboxed iframes. Host API versioned from day one.

## Iteration 1 note (2026-09-19)

Only first-party plugins exist. Their logic runs in Web Workers; sandboxed iframes for views are deferred until the first third-party view plugin. The typed Track API and grants are enforced from day one.
