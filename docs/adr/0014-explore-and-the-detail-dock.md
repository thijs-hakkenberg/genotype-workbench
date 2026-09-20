# ADR-0014: An Explore page, and details under the tracks

- **Status:** Accepted (2026-09-20)
- **Reversal cost:** Low
- **Relates to:** ADR-0005 (evidence kinds), ADR-0013 (linked scales)

## Context

Two problems showed up as soon as the packs were installed.

- **No way in.** The genome view opens at a region. With 640,000 calls and eleven packs, nothing said where to look, so the sequence, protein and 3D layers were easy to miss entirely.
- **A column too narrow for what it holds.** Details lived in a 340 px rail: six evidence cards stacked vertically, so the protein and its structure sat about 2,500 px down, while the area under the tracks was empty at any wide zoom.

## Decision

- **The detail dock.** Tracks take the full width. Selecting a position opens a dock beneath them: a one-line header (rsID, call, gene and consequence, review status), then cards across the width — the call, the classification, each frequency pack, the protein with its structure — and the associations in a row below. The calls table becomes a collapsible section.
- **The Explore page.** Four lists built by joining the kit with the installed packs: best-reviewed ClinVar records, strongest associations the kit carries an allele for, rarest alleles carried, and coding changes (translated on the device on request). Plus a gene search that counts the kit's calls per gene. Every row opens the genome view at that position.
- **Ordering is by evidence, and says so.** Review status, p-value, allele frequency, and the size of the change to a protein. Never by how important something might be for the person; the page says this in as many words, and each list carries its own caveat (rare is not harmful; chips mis-read rare positions; associations are population-level).
- **The overview points somewhere.** A "Where to look first" card links into those lists, so the first screen after import is not a dead end.

## Consequences

- One selection is visible in one screen, including the 3D view, at the cost of vertical space for tracks.
- Explore reads only installed packs, so it grows as packs are added and says which pack is missing when a list is empty.
- The coding scan is the first analysis that touches every call, so it runs on request and reports how many positions it covered against how many exist.
