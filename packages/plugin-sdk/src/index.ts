/**
 * Public contract between the Genotype Workbench host and its plugins.
 * Semver'd with the host API; see docs/adr/0005 and 0006.
 */

export const HOST_API_VERSION = '0.1.0';

/**
 * Does `range` (a manifest's `hostApi`) accept `version`?
 *
 * Only the two forms manifests actually use: an exact version, or a caret
 * range. Below 1.0.0 a caret pins the minor, so `^0.1` accepts 0.1.x and
 * refuses 0.2.0 — the host API is still allowed to break between minors.
 */
export function satisfiesHostApi(range: string, version = HOST_API_VERSION): boolean {
  const parts = (s: string) => s.replace(/^[\^~]/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [major, minor, patch] = parts(version);
  if (!range.startsWith('^') && !range.startsWith('~')) return range === version;
  const [wantMajor, wantMinor, wantPatch = 0] = parts(range);
  if (major !== wantMajor) return false;
  // A caret on 0.x, and a tilde anywhere, pin the minor too.
  if (major === 0 || range.startsWith('~')) return minor === wantMinor && patch! >= wantPatch;
  return minor! > wantMinor! || (minor === wantMinor && patch! >= wantPatch);
}

export type Capability = 'importer' | 'annotation-pack' | 'view' | 'connector' | 'analysis';

/** How a fact is known. Views choose their encoding from this (ADR-0005). */
export type EvidenceKind =
  | 'measured'
  | 'statistical-association'
  | 'curated-classification'
  | 'probabilistic-estimate'
  | 'population-frequency'
  | 'documentary';

export const EVIDENCE_KINDS: Record<EvidenceKind, { label: string; short: string; meaning: string }> = {
  measured: {
    label: 'Measured',
    short: 'measured',
    meaning: 'The chip read this base at this position. Error rate exists, but the bounds do not move.',
  },
  'statistical-association': {
    label: 'Association',
    short: 'association',
    meaning: 'A population-level association from a study. Not a statement about you.',
  },
  'curated-classification': {
    label: 'Classification',
    short: 'classification',
    meaning: 'A panel judged this, under review criteria, on a date. It can be revised.',
  },
  'probabilistic-estimate': {
    label: 'Estimate',
    short: 'estimate',
    meaning: 'A sampled or inferred value with bounds that are not exactly known.',
  },
  'population-frequency': {
    label: 'Population frequency',
    short: 'frequency',
    meaning:
      'How common an allele is in a sampled reference population. A fact about that population, not a measurement or an estimate about you.',
  },
  documentary: {
    label: 'Documentary',
    short: 'documentary',
    meaning: 'A record says so. Its weight comes from the source, which is always named.',
  },
};

export type ScientificDomain =
  | 'molecular-genetics'
  | 'genotyping'
  | 'population-genetics'
  | 'transmission-genetics'
  | 'statistical-genetics'
  | 'clinical-genetics'
  | 'pharmacogenomics'
  | 'genetic-genealogy'
  | 'documentary-genealogy';

export const DOMAIN_LABELS: Record<ScientificDomain, string> = {
  'molecular-genetics': 'Molecular genetics',
  genotyping: 'Genotyping',
  'population-genetics': 'Population genetics',
  'transmission-genetics': 'Transmission genetics',
  'statistical-genetics': 'Statistical genetics',
  'clinical-genetics': 'Clinical genetics',
  pharmacogenomics: 'Pharmacogenomics',
  'genetic-genealogy': 'Genetic genealogy',
  'documentary-genealogy': 'Documentary genealogy',
};

export type Build = 'GRCh37';
export type Chrom =
  | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12'
  | '13' | '14' | '15' | '16' | '17' | '18' | '19' | '20' | '21' | '22'
  | 'X' | 'Y' | 'MT';

export interface PluginManifest {
  id: string;
  version: string;
  hostApi: string;
  capabilities: Capability[];
  title: string;
  description?: string;
  firstParty?: boolean;
  permissions?: { network?: string[]; multiKit?: boolean };
}

/** Consumer chip formats are data, not code (ADR-0006). */
export interface FormatProfile {
  id: string;
  version: string;
  vendor: string;
  vendorLabel: string;
  build: Build;
  delimiter: '\t' | ',';
  commentPrefix: string;
  headerRow?: string;
  columns: { rsid: number; chrom: number; pos: number; genotype: number[] };
  noCallToken: string;
  strand: 'plus' | 'forward' | 'vendor-manifest';
  detect: { headerContains: string[]; buildMarkers: string[]; rejectMarkers?: string[] };
  chipVersions: { id: string; minRows: number; maxRows: number; label: string }[];
}

/** What a pack is for; the Annotation Library finds packs by role, not by id. */
export type PackRole =
  | 'reference'
  | 'genes'
  | 'classification'
  | 'association'
  | 'frequency'
  | 'rsid-merges'
  | 'genetic-map'
  | 'conditions'
  | 'haplotree-mt'
  | 'haplotree-y'
  | 'sequence'
  | 'proteins';

/** An annotation pack as listed in the signed Pack Index (ADR-0007). */
export interface PackManifest {
  schema: number;
  id: string;
  title: string;
  description: string;
  build: Build;
  role: PackRole;
  scientificDomain: ScientificDomain;
  evidenceKind: EvidenceKind;
  trackKind: TrackKind | null;
  /** Core reference data the app installs without asking (same origin). */
  core: boolean;
  licence: string;
  licenceClass: 'open' | 'share-alike' | 'non-commercial' | 'unverified';
  /** Frequency packs: the population groups their `af_*` columns hold, in display order. */
  frequencyGroups?: { key: string; label: string }[];
  source: { name: string; short: string; url: string };
  citation: string;
  version: string;
  sourceDate: string | null;
  locusVersion: string;
  builtAt: string;
  file: string;
  rows: number;
  columns: string[];
  size: number;
  sha256: string;
  stats: Record<string, unknown>;
  /** Path of the Parquet file relative to the index. */
  path: string;
}

export interface PackIndex {
  schema: number;
  generatedAt: string;
  packs: PackManifest[];
}

export type TrackKind = 'variant' | 'feature' | 'segment' | 'signal' | 'sequence' | 'protein';

/** Below this window width the reference sequence can be drawn base by base. */
export const SEQUENCE_BELOW_BP = 20_000;

export interface TrackDescriptor {
  id: string;
  kind: TrackKind;
  build: Build;
  /** Human name of the source, e.g. "23andMe v5" or "ClinVar". */
  source: string;
  version: string;
  evidenceKind: EvidenceKind;
  title: string;
  licence?: string;
  /** Shown when the track has nothing here, in its own words. */
  emptyMessage?: string;
}

export interface Region {
  chrom: Chrom;
  /** 1-based inclusive. */
  start: number;
  end: number;
}

/**
 * One positioned item of a track. `start`/`end` are 1-based inclusive.
 * `state` refines the encoding within an evidence kind (e.g. `no-call`).
 */
export interface TrackItem<Row = unknown> {
  id: string;
  start: number;
  end: number;
  label?: string;
  /** Scalar for signal tracks (e.g. allele frequency 0..1). */
  value?: number;
  /** Bounds for estimates; drawn with faded ends. */
  lo?: number;
  hi?: number;
  /** Strength for associations, e.g. -log10(p). */
  weight?: number;
  state?: 'no-call' | 'strand-ambiguous' | 'proposed' | 'stale' | 'matches-call' | 'other-allele';
  /** Set on binned items: how many records the bin [start, end] holds. Views draw density. */
  count?: number;
  row: Row;
}

/** Above this window width, tracks return binned counts instead of records. */
export const BIN_ABOVE_BP = 3_000_000;
export const BINS_PER_WINDOW = 600;

export interface TrackSource<Row = unknown> {
  descriptor: TrackDescriptor;
  itemsIn(region: Region, signal?: AbortSignal): Promise<TrackItem<Row>[]>;
}

/** A grant, scoped by kit, region, track kind and network host (Decisions B3). */
export interface Grant {
  id: string;
  pluginId: string;
  kits?: string[];
  regions?: Region[];
  trackKinds?: TrackKind[];
  networkHosts?: string[];
  grantedAt: string;
  scope: 'session' | 'persistent';
}

/**
 * A kit as a grant dialog must name it: whose DNA it is, not just its id.
 *
 * A person consenting on behalf of a relative should be able to read the
 * sentence aloud to them, so the subject's name travels with the kit
 * (docs/…/Genotype Workbench UI.dc.html section 04).
 */
export interface KitSubject {
  kitId: string;
  /** What the kit is called, e.g. "Mother — AncestryDNA". */
  label: string;
  /** Whose DNA it is, from the custody record. */
  dataSubject: string;
  /** `none` means no analysis may read it, whatever the user answers. */
  consentBasis: 'self' | 'recorded-consent' | 'none';
}

export interface ViewHandle {
  setRegion(region: Region): void;
  setTracks(tracks: TrackSource[]): void;
  destroy(): void;
}

export interface ViewPlugin {
  manifest: PluginManifest;
  supports(kind: TrackKind): boolean;
  mount(el: HTMLElement, tracks: TrackSource[], options: ViewOptions): ViewHandle;
}

export interface ViewOptions {
  region: Region;
  onRegionChange?(region: Region): void;
  onSelect?(track: TrackDescriptor, item: TrackItem): void;
  selectedId?: string;
}
