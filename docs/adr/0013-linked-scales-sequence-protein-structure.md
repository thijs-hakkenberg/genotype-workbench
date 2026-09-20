# ADR-0013: One view from sequence to genome track to 3D structure

- **Status:** Accepted (2026-09-20)
- **Reversal cost:** Low for the tracks, Medium for the CSP change
- **Relates to:** ADR-0004 (base genome view), ADR-0005 (track model), ADR-0006 (plugin contract), ADR-0007 (packs)

## Context

The recon (Decisions, "Views") listed SeqViz for sequence detail and Mol\* for 3D structure as "later", each as its own component. The goal, though, is one view that links the scales: keep zooming and the tracks become bases, then codons; select a coding position and see the residue in the protein. Three separate viewers, each with its own zoom, data formats and styling, would not link anything.

Two facts decided the shape:

- A chip gives genotypes, not sequence, and GRCh37 is 3 GB, so the sequence scale needs its own pack.
- SeqViz, Gosling, igv.js and JBrowse each bring a second browser (2–23 MB packages), their own interaction model and their own data formats, to do what the existing canvas track view already does.

## Decision

- **Sequence and protein are track kinds**, drawn by the existing view (`plugins/view-tracks`), so one zoom runs from the whole chromosome to a single base. `TrackKind` gains `sequence` and `protein`. Below 20 kb the reference bases appear; at about 7 pixels per base, letters replace marks, including the kit's own called bases.
- **Sequence ships as a pack** (`sequence-grch37`, role `sequence`): every protein-coding exon plus 25 bases around each chip locus, about 50 MB, from hs37d5. No sequence is fetched per region, so no server learns which regions are browsed.
- **The protein consequence is computed on the device** (`packages/protein`) from GENCODE coding blocks and those bases: which codon, which residue, and what the allele changes it to, in HGVS notation. It is deterministic bookkeeping over reference data and says nothing about whether a change matters. The mitochondrial genetic code is used on MT.
- **3D is a view plugin** (`plugins/view-structure`) wrapping Mol\*, rendered into a plain canvas with no second UI framework. Structures come from AlphaFold, one file per protein, cached in OPFS after the first view. UniProt (`proteins-uniprot`) maps transcript to protein.
- **The CSP gains one host**, `https://alphafold.ebi.ac.uk`. The policy is the outer bound (what is technically reachable); the Plugin Host grant is the inner gate (what the user allowed). Both are needed: a grant cannot widen the CSP, and the CSP alone permits nothing until granted.

## Consequences

- Asking for a structure tells AlphaFold which protein is on screen. That is stated in the grant dialog, it never happens without a grant, and the answer is cached so it happens once per protein.
- Gosling and igv.js stay unused. Gosling remains the candidate for chromosome painting when kinship (v0.3) gives it segments to paint; igv.js could still be added as an alternative `ViewPlugin`.
- A fourth evidence kind is not needed: a computed consequence is presented as documentary, with its inputs named.
