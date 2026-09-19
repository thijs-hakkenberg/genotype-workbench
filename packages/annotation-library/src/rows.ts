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

export interface GnomadRow {
  chrom: Chrom;
  pos: number;
  ref: string;
  alt: string;
  ac: number;
  an: number;
  af: number;
  af_lo: number;
  af_hi: number;
  af_afr: number | null;
  af_amr: number | null;
  af_asj: number | null;
  af_eas: number | null;
  af_fin: number | null;
  af_nfe: number | null;
  af_sas: number | null;
  af_oth: number | null;
}

export interface GeneRow {
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

export const GNOMAD_GROUPS: { key: keyof GnomadRow; label: string }[] = [
  { key: 'af_afr', label: 'African/African American' },
  { key: 'af_amr', label: 'Latino/Admixed American' },
  { key: 'af_asj', label: 'Ashkenazi Jewish' },
  { key: 'af_eas', label: 'East Asian' },
  { key: 'af_fin', label: 'Finnish' },
  { key: 'af_nfe', label: 'Non-Finnish European' },
  { key: 'af_sas', label: 'South Asian' },
  { key: 'af_oth', label: 'Other' },
];

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
