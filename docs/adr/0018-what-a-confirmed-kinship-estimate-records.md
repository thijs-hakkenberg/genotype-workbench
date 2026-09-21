# ADR-0018: What a confirmed kinship estimate records

- **Status:** Accepted (2026-09-21)
- **Reversal cost:** **High in practice, low on paper.** The schema can be migrated later; the evidence not captured at confirmation cannot be recovered, because kits get deleted, consent gets revoked and packs get updated.
- **Relates to:** ADR-0005 (evidence kinds), ADR-0009 (custody), ADR-0010 (analysis plugins), ADR-0015 (multi-kit grants), ADR-0016 (kinship)
- **Full analysis:** [Trade-off analyses](../Trade-off%20analyses.md#a--what-a-confirmed-kinship-estimate-records)

## Context

Kinship (ADR-0016) proposes; Pedigree records. `Core architecture.md:123` already fixes the shape — a relationship's provenance is `documented`, `genetic-estimate` (with cM range) or both, and Pedigree never reads genotype data. `Scientific domains.md:128` adds that results never write into Pedigree as facts: the user confirms, and the evidence is recorded.

What "the evidence is recorded" means in storage was never settled, and there is a reading of it that quietly breaks the rest.

**Kinship does not output a relationship. It outputs a list.** 2,648 cM at an opposite-homozygote rate of 1.52% gives one candidate, and the DNA has discriminated. 1,750 cM gives three — half sibling, grandparent, aunt or uncle — and the DNA has discriminated nothing; the person's choice came from documents, family knowledge or a photograph.

A record that stores only the chosen relationship loses that distinction. A reader in two years sees `half sibling · genetic-estimate` and believes the DNA said so. It did not. It said *second degree*, and a human picked one of three.

## Decision

- **A confirmed relationship holds Evidence records; it is not itself a claim.** Evidence is a separate aggregate the Relationship references, because a relationship accrues evidence over time: a document, then an estimate, then a better estimate once a parent's kit makes phasing possible.

- **The genetic evidence is a frozen snapshot**, copied at confirmation and never recomputed in place:
  - the kit pair, total cM, longest segment, segment count, kinship coefficient and opposite-homozygote rate
  - **the candidate list exactly as it was offered** — the warrant for the claim
  - the plugin and genetic-map pack at their versions, and the thresholds used
  - the caveats as they were shown, including that the data was unphased and that endogamy inflates totals

- **The human's confirmation is separate evidence of a different kind.** The estimate is `probabilistic-estimate`; the assertion "this is my sister" is `documentary`. Both are recorded, with who confirmed, when, **which candidate they chose**, and why in their own words. They are kept separable because they can later disagree — a document may support a relationship the DNA merely permits.

- **Nothing is recomputed silently.** A newer map or a newly importable parent's kit may change an estimate. Inheritance Analysis may then *propose an update*, which the person confirms again, adding evidence rather than rewriting it. Pedigree still never reads genotype data.

## Consequences

- A pedigree relationship becomes as auditable as every pack annotation already is. Without this it would have been the least-sourced claim in the product, and the only one the user wrote themselves.
- Storage per relationship grows by roughly a kilobyte of JSON. Measured against the cost of an unrecoverable gap, this was not a real trade-off.
- The re-proposal path is designed for now and built later. The storage shape must not assume one estimate per relationship.
- Deleting a kit no longer destroys the reasoning behind a link that kit produced.
