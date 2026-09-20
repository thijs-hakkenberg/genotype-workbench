import type { Chrom } from '@gw/plugin-sdk';

export interface ClinvarRow {
  chrom: Chrom;
  pos: number;
  ref: string;
  alt: string;
  variation_id: number;
  rsid: string | null;
  classification: string;
  review_status: string | null;
  stars: number;
  conditions: string[];
  /** Mondo id per condition, aligned with `conditions` (null when ClinVar gives none). */
  condition_mondo: (string | null)[];
  genes: string[];
  consequence: string[];
}

export interface GwasRow {
  chrom: Chrom;
  pos: number;
  rsid: string;
  risk_allele: string | null;
  risk_allele_freq: number | null;
  trait: string;
  mapped_trait: string | null;
  p_value: number | null;
  p_mlog: number | null;
  p_text: string | null;
  effect: number | null;
  effect_kind: 'or' | 'beta' | null;
  ci_text: string | null;
  pubmed_id: string;
  first_author: string;
  pub_date: string;
  journal: string;
  study: string;
  study_accession: string;
  initial_sample: string | null;
  mapped_gene: string | null;
}

/** A population-frequency row; `af_<group>` columns are named by the pack's `frequencyGroups`. */
export interface FrequencyRow {
  chrom: Chrom;
  pos: number;
  ref: string;
  alt: string;
  ac: number;
  an: number;
  af: number;
  af_lo: number;
  af_hi: number;
  [group: `af_${string}`]: number | null;
}

export interface GeneRow {
  canonical?: boolean;
  cds_starts?: number[];
  cds_ends?: number[];
  cds_frames?: number[];
  chrom: Chrom;
  start: number;
  end: number;
  strand: '+' | '-';
  gene_id: string;
  symbol: string;
  biotype: string;
  transcript_id: string | null;
  transcript_name: string | null;
  exon_starts: number[];
  exon_ends: number[];
  cds_start: number | null;
  cds_end: number | null;
}

export interface ProteinRow {
  accession: string;
  entry_name: string;
  name: string;
  symbol: string | null;
  length: number | null;
  sequence: string | null;
  transcripts: string[];
}

export interface ConditionRow {
  mondo_id: string;
  name: string;
  definition: string | null;
  synonyms: string[];
  orphanet: string[];
  omim: string[];
  medgen: string[];
}

export interface MergeRow {
  old_rsid: string;
  new_rsid: string;
  /** dbSNP build in which the merge happened. */
  build: number | null;
}

/** ClinVar's own ordering of classifications, strongest judgement first, for ties on review status. */
export function classificationRank(c: string): number {
  const s = c.toLowerCase();
  const order = ['pathogenic', 'pathogenic/likely pathogenic', 'likely pathogenic', 'risk factor', 'drug response',
    'association', 'protective', 'conflicting', 'uncertain', 'likely benign', 'benign/likely benign', 'benign', 'not provided'];
  const i = order.findIndex((o) => s.startsWith(o));
  return i === -1 ? order.length : i;
}

/** Short label drawn inside the classification outline. */
export function classificationShort(c: string): string {
  const s = c.toLowerCase();
  if (s.startsWith('conflicting')) return 'C';
  if (s.includes('pathogenic/likely pathogenic')) return 'P/LP';
  if (s.includes('benign/likely benign')) return 'B/LB';
  if (s.startsWith('likely pathogenic')) return 'LP';
  if (s.startsWith('pathogenic')) return 'P';
  if (s.startsWith('likely benign')) return 'LB';
  if (s.startsWith('benign')) return 'B';
  if (s.startsWith('uncertain')) return 'VUS';
  if (s.includes('drug response')) return 'DR';
  if (s.includes('risk factor')) return 'RF';
  if (s.startsWith('not provided')) return 'NP';
  return '·';
}

/**
 * One locus two kits both called, as the kinship analysis reads it.
 *
 * `ibs` is how many alleles the two genotypes share: 2, 1, or 0. `cm` is the
 * locus's cumulative position on the genetic map, null where the map has no
 * point below it. `het_a`/`het_b` are needed for the kinship coefficient,
 * which counts heterozygotes rather than segments.
 */
export interface SharedLocus {
  chrom: string;
  pos: number;
  cm: number | null;
  ibs: 0 | 1 | 2;
  het_a: boolean;
  het_b: boolean;
}

/** What the molecule carries at one position, and how well that is known. */
export interface HelixRow {
  /** The GRCh37 reference base here. */
  base: string;
  /** The kit's genotype, or null where this position was not read. */
  call: string | null;
  /** The base drawn on the molecule. */
  drawn: string;
  /**
   * `measured` — the kit read this position and both copies agree, so either
   * molecule carries the drawn base.
   * `heterozygous` — the two copies differ. Chip data is unphased, so neither
   * base can be placed on this molecule; the reference is drawn and both
   * letters are shown beside it.
   * `no-call` — read, but the chip could not tell.
   * `reference` — not on the chip at all; the reference base stands in.
   */
  state: 'reference' | 'measured' | 'heterozygous' | 'no-call';
}

/** The reference base, your call, and what that means for one position. */
export function helixRow(base: string, a1: string | null, a2: string | null, isNoCall: boolean): HelixRow {
  const clean = (b: string | null) => (b && 'ACGT'.includes(b) ? b : null);
  const [x, y] = [clean(a1), clean(a2)];
  if (isNoCall || !x) return { base, call: null, drawn: base, state: isNoCall ? 'no-call' : 'reference' };
  // A haploid call (MT, and Y or X in a male) has one copy, so it is not ambiguous.
  if (!y || x === y) return { base, call: x, drawn: x, state: 'measured' };
  return { base, call: `${x}${y}`, drawn: base, state: 'heterozygous' };
}
