# ADR-0001: GRCh37 as canonical reference build

- **Status:** Proposed (Unchanged)
- **Reversal cost:** High
- **Source:** docs/Core architecture.md

- **Context:** 23andMe, AncestryDNA and MyHeritage raw files report GRCh37 positions. ClinVar and gnomAD publish both builds.
- **Decision:** Store all calls and annotations on GRCh37. Every kit and pack records its build; importers reject or lift over anything else.
- **Consequences:** No liftover in the hot path. GRCh38-only sources are lifted over at pack-build time. A later move to GRCh38 is a migration, made tractable by the recorded build.
