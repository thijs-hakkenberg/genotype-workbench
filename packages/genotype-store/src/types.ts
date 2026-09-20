import type { Chrom } from '@gw/plugin-sdk';

export type ConsentBasis = 'self' | 'recorded-consent' | 'none';

/** Whose DNA, who imported it, and on what basis it may be analysed (ADR-0009). */
export interface Custody {
  dataSubject: string;
  custodian: string;
  consentBasis: ConsentBasis;
  consentNote?: string;
  recordedAt: string;
  /**
   * Every earlier basis, oldest first. A consent record may be added after
   * import, but what it used to say is never overwritten: who allowed what,
   * and when, is the whole point of the record.
   */
  history?: { consentBasis: ConsentBasis; consentNote?: string; recordedAt: string }[];
}

export type RefCheck =
  | 'match'
  | 'hom-non-ref'
  | 'complement-only'
  | 'mismatch'
  | 'unknown'
  | 'indel-unresolved'
  | 'not-applicable';

export interface ImportStats {
  rowsRead: number;
  calls: number;
  noCalls: number;
  strandAmbiguous: number;
  rejected: number;
  duplicatesMerged: number;
  duplicateConflicts: number;
  refChecks: Record<RefCheck, number>;
}

export interface ImportMeta {
  vendor: string;
  vendorLabel: string;
  importer: string;
  chipVersion: string | null;
  chipLabel: string | null;
  chipBasis: string;
  build: 'GRCh37';
  /** Whether the file stated the build, or the profile asserted it and why. */
  buildBasis: string;
  sourceSha256: string;
  locusVersion: string;
  stats: ImportStats;
  rejectedExamples: { line: number; reason: string }[];
}

/** A kit is immutable after import. */
export interface Kit extends Omit<ImportMeta, 'rejectedExamples'> {
  kitId: string;
  label: string;
  sourceName: string;
  importedAt: string;
  /** `reference-grch37@version` the calls were checked against, or null. */
  referencePack: string | null;
  file: string;
  custody: Custody;
}

/** A normalized call as the read API returns it. */
export interface CallRow {
  chrom: Chrom;
  pos: number;
  ref: string | null;
  a1: string | null;
  a2: string | null;
  rsid: string;
  is_nocall: boolean;
  strand_ambiguous: boolean;
  ref_check: RefCheck;
}

export interface DensityBin {
  chrom: Chrom;
  bin: number;
  calls: number;
  noCalls: number;
}

/** Plain-language labels for reference-check states (UI page, section 06). */
export const REF_CHECK_LABELS: Record<RefCheck, string> = {
  match: 'Contains the GRCh37 reference base',
  'hom-non-ref': 'Differs from the GRCh37 reference on both copies',
  'complement-only': 'Probably reported on the other strand — flagged, not flipped',
  mismatch: 'Neither allele fits the reference — possible chip error',
  unknown: 'Reference base not known at this position',
  'indel-unresolved': 'Chip insertion/deletion call — sequence not reported',
  'not-applicable': 'No-call — nothing to check',
};
