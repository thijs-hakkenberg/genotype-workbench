# ADR-0012: Packs declare a role; haplogroups as the first single-kit analysis

- **Status:** Accepted (2026-09-19)
- **Reversal cost:** Low
- **Relates to:** ADR-0006 (plugin contract), ADR-0007 (packs), ADR-0009 (custody), ADR-0010 (analysis plugins)

## Context

Iteration 1 looked packs up by id (`genes-ensembl75`, `gnomad-chip`). Replacing Ensembl 75 with GENCODE, and adding 1000 Genomes next to gnomAD, would have meant code changes for every new source.

## Decision

- **Pack roles.** Every pack manifest carries a `role`: `reference`, `genes`, `classification`, `association`, `frequency`, `rsid-merges`, `genetic-map`, `conditions`, `haplotree-mt` or `haplotree-y`. The Annotation Library finds packs by role, so a newer source of the same kind replaces or joins an older one without code changes.
- **Haplogroups.** `plugins/analysis-haplogroups` is the first `analysis` plugin. It reads one kit's MT and Y calls and the tree packs:
  - mtDNA uses PhyloTree 17 with a weighted Kulczynski match (as HaploGrep). Ties go to the branches' common ancestor.
  - Y uses YFull YTree placed on GRCh37 via YBrowse, and reports the deepest branch with derived support.
  - Results are shown as estimates with their support.
  - It never runs on a kit whose custody record has no consent basis (ADR-0009).
- **Licence classes.** `licenceClass` gains `unverified` for data whose terms are not published (YBrowse SNP positions). Such packs are marked in the UI.

## Consequences

- The Kinship plugin (v0.3) follows the same shape, reading two kits and the `genetic-map` pack.
- Mitotree (FamilyTreeDNA) is non-commercial only, so it cannot ship first-party. PhyloTree 17 is frozen (2016), but its HaploGrep packaging is MIT.
