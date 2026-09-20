# ADR-0017: The double helix as a ribbon model, drawn from published B-form parameters

- **Status:** Accepted (2026-09-21)
- **Reversal cost:** Low (one renderer, one panel, no stored data)
- **Relates to:** ADR-0004 (view adapter), ADR-0005 (track model), ADR-0013 (linked scales), ADR-0016 (painting without Gosling)

## Context

The app already runs a chain of scales: chromosome → region → reference bases → codons → the protein's predicted shape. The one rung missing is the molecule the whole thing is a reading of.

Drawing DNA is easy to do badly. A decorative helix that ignores its own geometry, or one that shows a person their "own" DNA when almost every base on screen is the reference standing in, would be the kind of confident picture this project exists not to make.

## Decision

### A ribbon model, not an atomic one

Two backbones and the base pairs between them, drawn from the published B-form parameters: **10.5 base pairs per turn, 3.38 Å rise, 20 Å across, a 12 Å minor and a 22 Å major groove**. The turn, the right-handedness and the unequal grooves are therefore real. The atoms are not drawn at all, rather than drawn approximately.

The angular offset between the backbones is derived from the published groove widths, so the narrow side spans 12/(12+22) of the way round and the wide side the rest. Setting the strands opposite each other would give two identical grooves and a helix that reads as a ladder.

The twist is taken from the absolute genomic position, so panning slides the same molecule past rather than re-winding it.

### One molecule, and it says which bases are yours

A person has two copies of each autosome; a helix is one of them. Three cases, three forms:

- **Both copies agree** — either molecule carries that base, so it is drawn, marked as measured.
- **The copies differ** — chip data is unphased, so placing either base on this molecule would be a guess about which parent it came from. The reference base is drawn, the rung is doubled, and both of your letters appear beside it.
- **Not read at all** — the reference base stands in, in the neutral ramp. Most bases in any window are this, because a chip reads positions, not stretches.

### Two views of the same geometry

A `helix` track in the genome view shows it from the side, under the sequence and protein tracks, so the chain stays continuous. A card in the detail dock shows it end-on, down the axis, where the turn *is* the shape — the ten or so nearest base pairs form a rosette, and because 10.5 is not a whole number the pattern never quite repeats.

Both read the same functions, so the two views cannot disagree.

### Drawn below 400 bases

A turn is 10.5 bases. Much beyond 400 in a window and the twist is finer than a pixel, so the drawing would say nothing true about the shape. Above that the row says so.

### Not Mol\*, yet

Mol\* is already a dependency and already renders nucleic acids, and generating B-DNA coordinates for a sequence is a known procedure. It is deferred rather than rejected: it needs published nucleotide atom templates carried with their provenance, and a wrong template is a quiet scientific error rather than a visible bug. When it lands it belongs in the same dock card as this end-on view, beside the AlphaFold structure, under the same grant discipline.

## Consequences

- `TrackKind` gains `helix`; the renderer joins `sequence`, `protein` and `segment` in the in-house canvas view.
- The geometry lives in `plugins/view-tracks/src/helix.ts` as pure functions and is unit-tested against textbook values — a full turn returns to the same place, a stretch of 1,000 bases is 3,380 Å, the grooves come out in the published proportion.
- What a position carries (`helixRow`) lives with the other row types in the Annotation Library, because it is a fact about the data rather than about the drawing. The renderer types it structurally, as the other renderers do, so no view depends on a library and no library depends on a view.
- Empty and error states are now also set as `aria-label` on each track's canvas: text painted into a canvas is invisible to a screen reader, and an empty track has something to say.
