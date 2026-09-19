# ADR-0010: Inheritance Analysis as a plugin-based context (new)

- **Status:** Proposed (New (B5, scientific domains))
- **Reversal cost:** Medium
- **Source:** docs/Core architecture.md

- **Context:** Transmission genetics (Mendelian checks, phasing) and genetic genealogy (shared segments) both need several kits plus the pedigree. No context owned them.
- **Decision:** One Inheritance Analysis context, built from `analysis` plugins: Kinship first, then Mendelian check and Phasing. Results are proposed to Pedigree, never written as facts.
- **Consequences:** The plugin API is proven on its hardest case early. Relatives' kits become a data-quality gain, not only a privacy cost.
