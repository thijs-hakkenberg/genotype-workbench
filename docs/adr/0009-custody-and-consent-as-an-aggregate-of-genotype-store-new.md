# ADR-0009: Custody and consent as an aggregate of Genotype Store (new)

- **Status:** Proposed (New (B4))
- **Reversal cost:** Medium
- **Source:** docs/Core architecture.md

- **Context:** Once a relative's kit is imported, the person whose DNA it is and the person who imported it differ.
- **Decision:** Every kit has a Custody record: data subject, custodian, consent record. Analysis plugins can read a kit that isn't the custodian's own only with a consent record.
- **Extraction trigger:** Move Custody to its own context if consent rules come to depend on pedigree relationships.
