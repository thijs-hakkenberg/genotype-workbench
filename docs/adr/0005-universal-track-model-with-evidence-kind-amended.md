# ADR-0005: Universal track model with evidence kind (amended)

- **Status:** Proposed (Amended (scientific domains))
- **Reversal cost:** High
- **Source:** docs/Core architecture.md

- **Decision:** A Track is `{id, kind, build, source, version, schema, evidenceKind}` plus rows keyed by `(chrom, start, end)`. Kinds: `variant`, `feature`, `segment`, `signal`. Evidence kinds: `measured`, `statistical-association`, `curated-classification`, `probabilistic-estimate`, `documentary`.
- **Consequences:** Any view renders any supported track and chooses its encoding from the evidence kind. A GWAS association can't look like a ClinVar classification by accident.
