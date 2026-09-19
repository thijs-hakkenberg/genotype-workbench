# ADR-0008: Locus published language with one reference normalizer (new)

- **Status:** Proposed (New (B1))
- **Reversal cost:** High
- **Source:** docs/Core architecture.md

- **Context:** Genotype Store, Annotation Library and the pack pipeline must agree exactly on build, strand and allele representation, or joins go silently wrong.
- **Decision:** Publish the Locus language (key, allele rules, glossary) and implement `normalize()` once, in Rust, compiled to WASM, native and Python. The host exposes it to every plugin. rsID is a lookup, not a key. VRS is an export mapping.
- **Rejected:** A spec that each component implements separately (drift causes silent wrong joins); VRS digests as internal keys (too costly per row, too steep for plugin authors).
