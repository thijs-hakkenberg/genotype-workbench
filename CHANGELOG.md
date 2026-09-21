# Changelog

Milestones follow the roadmap in `docs/Core architecture.md`, and the app
version follows the milestones — but it can advance within one, so 0.3.1 is
still the v0.3 milestone rather than the start of v0.4.

The app version is also its own number: the **locus version** shown beside each
kit records which normalizer produced that kit's calls, and moves only when
`crates/locus` does.

## 0.3.3 — 2026-09-21

### Added

- **A synthetic profile generator**, for anyone who has no raw data file or would rather not put their own in yet. It writes the GRCh37 reference at the positions consumer chips read — about 1.5 million of them — with alleles either left as the reference or drawn at random, and imports the result through the ordinary path, so the Rust normalizer checks every base exactly as it would for a real export and a generated kit is comparable with an imported one. Generating in about three seconds.
- Nothing about it can pass as a person. It carries its own format profile, so every surface that names a source says **Synthetic**; its custody record names *nobody* as the data subject; and a fourth consent basis, `synthetic`, records that consent does not apply here rather than that it was given. rsIDs are left empty on purpose — an rsID is a name dbSNP gives a position somebody observed, and inventing one would be inventing a citation.
- The same seed always produces the same profile, so a finding can be reproduced or two profiles compared.

## 0.3.2 — 2026-09-21

### Fixed

- **The molecule was almost impossible to find.** The reference sequence pack covers coding exons and chip positions, which is around 1.5 million small islands — a median of 51 bases — rather than a continuous genome, so zooming to a few hundred bases anywhere in particular landed in a gap nearly every time, and the helix track just said it had nothing to draw. The genome view now has a **take me to the molecule** link that jumps to the nearest stretch with sequence in it, preferring a position this kit actually called, since that is the one base on screen that is yours rather than the reference. The empty message points at it.
- A track no longer reports "0 drawn in this window" to assistive technology while its query is still running. That is a claim about the window, and it has not been read yet.

## 0.3.1 — 2026-09-21

The molecule everything else is a reading of.

### Added

- **The double helix**, drawn from the published B-form measurements — 10.5 base pairs per turn, 3.38 Å rise, 20 Å across, a 12 Å minor and a 22 Å major groove — so the turn, the handedness and the unequal grooves are real rather than stylised. A track in the genome view shows it from the side, below the sequence and protein; a card in the detail dock shows it end-on, looking down the axis, where the ten or so nearest base pairs form a rosette.
- The two views are honest about whose bases they show. Where both your copies agree, your base is drawn and marked as measured. Where they differ, the reference base is drawn and both of your letters appear beside a doubled rung: chip data is unphased, so neither base can be placed on one molecule without guessing which parent it came from. Everything else is the reference standing in, because a chip reads positions rather than stretches.

### Changed

- Each track's empty or failed state is now also set as an `aria-label` on its canvas. Text painted into a canvas is invisible to a screen reader, and an empty track has something to say.

## 0.3.0 — 2026-09-20

Inheritance Analysis: reading a second person's DNA, under a grant that names them.

### Added

- **Shared DNA.** Two kits compared on this device: the stretches where they match, and every relationship that much sharing is consistent with. A parent is told from a sibling by the rate at which they disagree completely, not by how much they share, which cannot distinguish them.
- **Chromosome painting.** Where the sharing sits, across every chromosome that was compared. A square end is a boundary a mismatch proves; a faded end means the stretch left the chip and continues somewhere unknown.
- **Consent grants that name people.** A plugin asking to read whole kits must name them and their data subjects. A kit whose custody record has no consent basis is never granted, whatever the dialog is answered — and a consent record can now be added after import, by appending rather than overwriting.
- **Three more vendors.** AncestryDNA, MyHeritage and FamilyTreeDNA exports import alongside 23andMe. Where a vendor does not write the genome build into the file, the profile says on whose word the positions are trusted.
- **A pedigree simulator** in the fixture generator: gametes recombine over the genetic map, so a simulated pair really shares segments and the truth is known by construction.
- **This changelog**, reachable from the version in the header.

### Changed

- The version in the header is the app's own, from the root `package.json`, instead of a string that had read `v0.1` since the first commit.
- Plugin manifests asking for a host API this host does not implement are now refused, rather than displayed unchecked.
- The genome view can draw `segment` tracks, so a shared stretch also appears beside the evidence at those positions.

### Fixed

- A genetic map that does not reach a position no longer contributes a centimorgan value borrowed from a point megabases away.
- Marker density is measured across the whole comparison rather than the part the map happens to cover, so a partial map can no longer make sparse chips look finely resolved.
- The coding scan, the protein track and the detail dock now check that the installed gene models pack actually carries coding blocks, and name the pack to install when it does not, instead of failing inside SQL.
- The repository's no-genomes guard knows all four vendors. It previously could not have recognised a real MyHeritage or FamilyTreeDNA export.

## 0.2.0 — 2026-09-20

Everything at once, from a whole chromosome down to a single amino acid.

### Added

- **Sequence, protein and 3D structure** in one view: keep zooming and the tracks become reference bases, your own called bases, and the gene's codons. A coding position names its residue, and Mol\* shows it in the protein's predicted shape after you grant the one request it takes.
- **Explore**, a page of starting points drawn from your own calls, ordered by how well established the evidence is and never by how important it might be for you.
- **The detail dock**: selecting a position opens a panel beneath the tracks, side by side rather than stacked in a column.
- **Lineages**: maternal-line and paternal-line haplogroups, matched on this device, shown with the markers that support them.
- **A sixth evidence kind**, `population-frequency`. A frequency is a fact about a sampled population, not an estimate about you, so it no longer borrows the estimate's form.
- More public sources: 1000 Genomes frequencies, GWAS Catalog, Mondo condition names, dbSNP rsID merges, the HapMap genetic map, GENCODE gene models, GRCh37 coding sequence and the UniProt proteome.

### Changed

- Packs declare a **role** rather than being looked up by id, so a newer source of the same kind replaces an older one without code changes.
- One button installs every pack on offer, and the app checks the site's storage quota first.

### Fixed

- A second tab now explains that the workbench is open elsewhere and recovers when the first closes, instead of failing to start.
- The install-time telemetry Mol\* pulls in (`@scarf/scarf`) is refused: this app does not phone home, not even while being built.

## 0.1.0 — 2026-09-19

The foundations: bring your own raw DNA file, and look at it.

### Added

- **Import** of 23andMe raw data (chips v3–v5, build 37), read and normalized in a Web Worker by the Rust `locus` normalizer compiled to WASM. Every call is checked against the GRCh37 reference base.
- **A custody record** — whose DNA, who imported it, on what basis — required before a kit is stored.
- **The genome view**: a canvas track view drawing each track in its evidence kind's form, so an association never looks like a classification.
- **Annotation packs** from a signed index, downloaded whole and joined on this device, so which variants you carry is never sent anywhere.
- **The Plugin Host**: no plugin reaches the network without a grant naming the host.
