# ADR-0016: Kinship computes in DuckDB and TypeScript; painting is drawn here, not by Gosling

- **Status:** Accepted (2026-09-20)
- **Reversal cost:** Low (both are internal; the plugin boundaries do not move)
- **Relates to:** ADR-0003 (DuckDB), ADR-0004 (view adapter), ADR-0005 (track model), ADR-0010 (analysis plugins), ADR-0013 (linked scales)
- **Deviates from:** Decisions S5 (analysis compute in Rust → WASM), Decisions S10 (Gosling.js for chromosome painting)

## Context

Two documented choices predate the v0.3 build and both turned out to be wrong for this milestone.

**S5** says analysis compute belongs in Rust compiled to WASM in a Worker, because "segment detection over millions of positions is CPU-bound". **S10** says chromosome painting will be a Gosling.js view, and ADR-0013 parked Gosling "until kinship gives it segments to paint". Kinship now has segments to paint, so the decision could no longer be deferred.

## Decision

### Kinship computes as a DuckDB join plus a TypeScript walk

Both kits are already attached as DuckDB views (`kit_<uuid>`), so the expensive half — joining ~600k positions against ~600k and classifying each — is one query the engine is built for, and it runs beside the genetic map in the same database. `AnnotationLibrary.sharedLoci` reduces two kits to one row per shared locus; the plugin walks that stream to find runs, tolerate chip error and total the centimorgans.

This follows `analysis-haplogroups`, which is likewise a pure TypeScript function over rows the host fetched. A new Rust crate would have added a build step and a second place allele comparison could drift from `crates/locus`, for compute that is not in fact the bottleneck: the reduction is in the database, and the walk is linear over the result.

The Locus rule is untouched — the crate still normalizes every call. Comparing two already-normalized calls is not normalization.

### Chromosome painting is an in-house canvas view

`plugins/view-painting` is a second first-party `ViewPlugin`, drawing every analysed chromosome as an ideogram with segments painted on.

Gosling was declined for the same reason igv.js was in ADR-0004: it cannot draw the encodings this design system requires. A segment's two ends carry the finding — a square end is a boundary an opposite-homozygote locus proves, a faded end is a run that left the chip and continues somewhere unknown — and that distinction is the whole reason to draw a segment rather than list it. Gosling's grammar has no notion of an end whose position is unknown, so adopting it would mean bending the design system to the library on exactly the point the design system exists to make.

The cost side agrees: Gosling brings React and HiGlass into an app that is otherwise framework-free canvas, along with their install scripts, in a project that already refuses one dependency for phoning home at install time.

### A view draws only what was examined

`PaintingView` takes the chromosomes to draw, and the kinship page passes the autosomes. An empty chromosome drawn beside full ones reads as "nothing found here"; drawing one that was never examined would state a finding that was never made.

## Consequences

- S5 stands for anything genuinely CPU-bound that DuckDB cannot express. If a future analysis needs it, the Worker boundary is unchanged and a crate can be added then.
- Gosling and igv.js remain unused. Both stay available as alternative `ViewPlugin`s; neither is on the path now.
- `TrackKind: 'segment'` is live at last, with a renderer in `view-tracks` as well, so a shared stretch appears in the genome view beside the evidence at those positions.
- X, Y and MT are outside kinship. A shared X stretch means different things depending on each person's sex, and Y and MT do not recombine, so none of them belongs in a centimorgan total. They are the haplogroup analysis's territory.
