# ADR-0004: igv.js as the base genome view, behind a View adapter

- **Status:** Proposed (Unchanged)
- **Reversal cost:** Low
- **Source:** docs/Core architecture.md

- **Decision:** The v0.1 base view is igv.js fed from DuckDB. All views go through a `ViewPlugin` adapter. Chromosome painting moves to a Gosling.js view in the Inheritance Analysis milestone.

## Iteration 1 note (2026-09-19)

Iteration 1 ships a custom canvas track view (`plugins/view-tracks`) behind the `ViewPlugin` interface, because igv.js cannot draw the evidence-kind encodings from the UI design page. igv.js stays the planned second view for deep browsing.
