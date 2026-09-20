# Changelog

Milestones follow the roadmap in `docs/Core architecture.md`. The app version
is its own number: the **locus version** shown beside each kit records which
normalizer produced that kit's calls, and moves only when `crates/locus` does.

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
