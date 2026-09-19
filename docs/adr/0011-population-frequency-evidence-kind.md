# ADR-0011: A sixth evidence kind, population-frequency

- **Status:** Accepted (2026-09-19)
- **Reversal cost:** Medium (a data-model value every view and pack reads)
- **Amends:** ADR-0005 (universal track model with evidence kind)

## Context

Iteration 1 drew gnomAD allele frequencies as `probabilistic-estimate`: a point inside a band that fades at both ends. That is the same form kinship relationship estimates will use in v0.3. But an allele frequency is neither a measurement of the person nor an estimate about the person. It is a fact about a sampled population. With both drawn alike, a reader could take "12% of gnomAD genomes carry T" as "12% chance about you", which principle 5 rules out.

## Decision

- Add `population-frequency` as a sixth evidence kind, meaning how common an allele is in a sampled reference population.
- Its mark is a framed column filled to the allele's share. The frame is the sampled population: a known size, so hard edges. The top of the fill fades across the 95% sampling interval, following the edge rule from the UI page: a faded end is an unknown bound.
- Frequency packs declare `frequencyGroups` (the population groups their `af_*` columns hold), so any frequency source renders the same way. The first two are 1000 Genomes and gnomAD.
- Copy always says "a fact about that population, not about you".

## Consequences

- Five marks become six. The legend, the pack list and the selected-position panel gain the frequency form.
- `computational-prediction` (e.g. AlphaMissense) is expected to become a seventh kind when such a pack lands. It is deliberately not added before there is data for it.
