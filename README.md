# Genotype Workbench

A local-first workbench for your own raw DNA file. Import a 23andMe export, explore it on a genome view, and join it to public databanks that arrive as whole downloaded packs. Everything runs in your browser: the file is never uploaded, and nothing reaches the network unless you grant it.

![The genome view: your calls, gene models, ClinVar classifications, GWAS associations, population frequency, the reference sequence and the protein, each drawn in its own evidence form](docs/screenshots/genome-tracks.png)

<sub>Every screenshot shows a synthetic kit (random genotypes on real chip positions), never a real person's DNA.</sub>

Design and decisions live in [`docs/`](docs/): [Core architecture](docs/Core%20architecture.md), [Decisions](docs/Decisions(1).md), [Scientific domains](docs/Scientific%20domains.md), the [ADRs](docs/adr/) and the Nocturne design system with the UI mockups.

## What it does

**Import.** A 23andMe raw data file (chips v3–v5, build 37) is read and normalized in a Web Worker by the Rust `locus` normalizer compiled to WASM, in about 1–2 s for a 640k-row v5 file. Every call is checked against the GRCh37 reference base. Strand-ambiguous (A/T, C/G) calls are flagged, no-calls are kept, and duplicate probes are merged. A custody record — whose DNA, who imported it, on what basis — is required before the kit is stored.

![Import: the normalization report, with call rate, strand-ambiguous count and reference checks, above the custody record it requires](docs/screenshots/import.png)

**Explore.** Starting points drawn from your own calls by joining them with the installed packs. Ordered by how well established the evidence is — review status, p-value, allele frequency — never by how important it might be for you. Includes a gene search that counts your calls per gene.

![Explore: best-reviewed ClinVar records, strongest associations, rarest alleles, coding changes, and a gene search showing MTHFR with 21 calls](docs/screenshots/explore.png)

**Overview.** Call statistics, reference consistency, probe coverage per chromosome, the custody record, your calls per ClinVar classification, and a card pointing at where to look first.

![Kit overview: 636,108 calls, 98.5% call rate, 100% reference consistency, probe density per chromosome, custody and starting points](docs/screenshots/overview.png)

**The genome view.** Tracks run the full width, each drawn in its evidence kind's form, so an association never looks like a classification. Pan, zoom, click to select, and search by region, rsID (including retired ones) or gene. Wide windows switch to binned density.

**The detail dock.** Selecting a position opens a panel beneath the tracks: your call and how it was checked, the classification with its conditions, each frequency pack, the protein, and the associations in a row below — side by side rather than stacked in a column.

![The detail dock for rs1801133: the call, ClinVar with its conditions, 1000 Genomes frequency by population, and the protein card offering to fetch the structure](docs/screenshots/genome-dock.png)

**Sequence and protein.** Keep zooming and the tracks become the reference bases, your own called bases as letters, and the codons of the gene in view.

![At 101 bases: a heterozygous call shown as stacked letters, the reference sequence, and MTHFR's codons with their amino acids](docs/screenshots/sequence.png)

**3D structure.** A coding position names its residue and what the allele changes it to, computed here from GENCODE coding blocks and the GRCh37 sequence. Mol\* then shows the residue in the protein's predicted shape, after you grant the one request it takes.

![MTHFR p.Ala222Val: codon 222 reads GCC in the reference and GTC with A, with residue 222 marked in the AlphaFold structure](docs/screenshots/genome-protein.png)

**Lineages.** Maternal-line (mtDNA, PhyloTree 17) and paternal-line (Y, YFull YTree) haplogroups, matched on this device, shown with the markers that support them and what the chip could not read.

![Lineages: the best-matching mtDNA and Y haplogroups, with positions read, markers carried, and each tree's licence](docs/screenshots/lineages.png)

**Packs.** Public databanks arrive as whole packs from a signed index, each with its licence, size, row count and source. One button installs everything on offer; the app checks the site's storage quota first.

![The Packs page: eleven packs with licence, evidence kind, size and citation, and an Install all button](docs/screenshots/packs.png)

| Pack | Role | Evidence kind | Licence |
| --- | --- | --- | --- |
| GRCh37 reference at chip loci (core) | reference | documentary | Public domain |
| GENCODE 50 genes, lifted to GRCh37 | genes | documentary | Open access |
| GRCh37 sequence at coding exons and chip loci | sequence | documentary | Public domain |
| UniProt reviewed human proteome | proteins | documentary | CC BY 4.0 |
| ClinVar | classification | curated classification | CC0 |
| GWAS Catalog (lifted to GRCh37) | association | statistical association | CC0 |
| 1000 Genomes phase 3 frequencies | frequency | population frequency | Open |
| gnomAD v2.1.1 frequencies (on demand) | frequency | population frequency | CC0 |
| Mondo condition names | conditions | documentary | CC BY 4.0 |
| dbSNP rsID merges | rsid-merges | documentary | Public domain |
| HapMap II genetic map | genetic-map | estimate | Public |
| PhyloTree 17 mtDNA tree | haplotree-mt | documentary | MIT packaging |
| YFull YTree + YBrowse positions | haplotree-y | documentary | CC BY 4.0 + unverified |

They are built by `tools/packkit` (Python + DuckDB, normalized through the same Rust code via `locus-py`). The app downloads each pack whole, checks its SHA-256 against the signed index, and joins it locally: no variant is ever looked up remotely.

**Every network request is asked for.** A pack download or a structure request names the host, the size, what is sent (nothing about you) and which kits are read (none).

![The grant dialog: host, purpose, size, storage left, and that nothing about you is sent](docs/screenshots/grant.png)

**What ClinVar says about your calls.** Positions where your call carries an allele a ClinVar record classifies, strongest evidence first: review status, then the strongest association at the same position.

![The ClinVar list: records ordered by review status with the strongest GWAS association at each position](docs/screenshots/clinvar.png)

Information, not diagnosis: the app shows what sources say, with citations. It computes no risk score.

## Quick start

Requirements: Node 22+, pnpm 11, Rust (stable) with the `wasm32-unknown-unknown` target, `wasm-pack`, and `uv`. The gnomAD pack also needs `bcftools`.

```sh
pnpm install
pnpm packs:chip-loci        # positions probed by 23andMe chips (from CC0 Harvard PGP files; positions only)
pnpm packs:build --skip gnomad-chip   # reference, genes, ClinVar, GWAS Catalog into packs-dist/
pnpm dev                    # builds the WASM + DuckDB extensions, serves the app with packs at /packs/
```

Open the printed URL, import your raw data file, then install packs from **Packs**.

The gnomAD pack streams about 460 GB of gnomAD v2.1.1 VCFs and keeps only chip loci. It writes only the filtered result (tens of MB), not the source, so the 460 GB is download traffic, not disk space. It takes hours; run it on purpose with `pnpm packs:build --only gnomad-chip`. The build resumes per chromosome, and `GW_GNOMAD_JOBS` sets the number of parallel streams. 1000 Genomes (a 1.5 GB stream) is the default frequency pack.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm preview` | App (Vite, Svelte 5, PWA) |
| `pnpm test` | Rust tests (incl. golden file) and Vitest |
| `pnpm test:e2e` | Playwright: import → overview → genome → pack install → reload, asserting no off-origin requests |
| `pnpm check` | `svelte-check` type checking |
| `pnpm packs:build [--only id…] [--skip id…]` | Build packs into `packs-dist/` and sign the index |
| `uv run --project tools/packkit packkit fixtures` | Cut small signed fixture packs for tests |
| `pnpm fixtures:kits -- --rows 5000 --out …` | Synthetic 23andMe-format kits (random genotypes on real chip loci) |
| `pnpm check:no-genomes` | Fail if a real raw-data export is tracked |

## Layout

```
apps/web/                 Svelte 5 PWA shell; CSP connect-src 'self'
crates/locus/             Locus language: key, alleles, normalize(), reference check (ADR-0008)
crates/genotype-import/   declarative format-profile engine
crates/locus-wasm/        WASM bindings for the import worker
crates/locus-py/          Python bindings for pack builds
packages/plugin-sdk/      public plugin types (host API ^0.1)
packages/storage/         DuckDB-WASM over Parquet in OPFS
packages/genotype-store/  Kit, Call, Custody; import and read API
packages/annotation-library/  signed index, pack install, local joins, annotation tracks
packages/plugin-host/     manifests, grants, guarded fetch
packages/protein/         genome position to codon and residue; the genetic code
plugins/                  profile-23andme, view-tracks, view-structure (Mol*),
                          analysis-haplogroups, pack-* build scripts
tools/packkit/            pack pipeline (uv)
fixtures/                 synthetic kits and fixture packs; never real data
```

## One tab at a time

Kits and packs are files on the device, and the query engine opens them exclusively, so the app runs in one tab per browser profile. A second tab says so and offers to retry; it recovers as soon as the first tab closes.

## Privacy guard rails

- Real raw-data exports are never committed: `.gitignore` covers them, and CI runs `scripts/check-no-genomes.sh`.
- A Content Security Policy limits the app to its own origin, plus one host: `alphafold.ebi.ac.uk`, for protein structures. The policy is the outer bound; a Plugin Host grant is still required before anything is fetched (ADR-0013). DuckDB extensions are vendored (`scripts/vendor-duckdb-extensions.mjs`, hash-pinned), and fonts are bundled.
- Packs are whole files. No variant is ever looked up remotely.
- Install scripts that report home are refused: Mol* pulls in `@scarf/scarf`, denied in `pnpm-workspace.yaml`.

## Deviations from the docs, by design

- **Genome view.** A custom canvas track view replaces igv.js for now, because igv.js cannot draw the evidence-kind encodings (ADR-0004 note).
- **Plugin sandboxing.** Sandboxed iframes are deferred until third-party plugins exist. First-party logic runs in workers (ADR-0006 note).
- **Metadata storage.** Kit, pack and grant metadata are small JSON files in OPFS. Calls and packs are Parquet.
- **Six evidence kinds.** `population-frequency` was added (ADR-0011): a frequency is a fact about a sampled population, not an estimate about you, so it no longer shares the estimate's form.

## Licence

Not chosen yet (open question in the docs: MIT/Apache vs AGPL). Pack data carries its own licences, shown next to each pack.
