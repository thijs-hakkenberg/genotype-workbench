/**
 * From a genome position to a residue.
 *
 * Everything here is deterministic bookkeeping over reference data: which
 * codon of which transcript a position falls in, and what the call changes
 * that codon into. It says nothing about whether a change matters.
 */
import type { Chrom } from '@gw/plugin-sdk';
import { aaThreeLetter, complement, reverseComplement, translateCodon, type GeneticCode } from './code';

export * from './code';

/** The coding blocks of one transcript, as the genes pack stores them. */
export interface CodingTranscript {
  transcript_id: string | null;
  transcript_name?: string | null;
  symbol?: string;
  chrom: Chrom;
  strand: '+' | '-';
  cds_starts: number[];
  cds_ends: number[];
  /** GTF frame per block: bases to skip before this block's first whole codon. */
  cds_frames: number[];
}

/** A stretch of reference sequence, as the sequence pack stores it. */
export interface SequenceRange {
  chrom: Chrom;
  start: number;
  end: number;
  seq: string;
}

/** Reference bases by position, over the ranges a sequence pack returned. */
export class SequenceIndex {
  private ranges: SequenceRange[];

  constructor(ranges: SequenceRange[]) {
    this.ranges = [...ranges].sort((a, b) => a.start - b.start);
  }

  base(pos: number): string | null {
    let lo = 0;
    let hi = this.ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = this.ranges[mid]!;
      if (pos < r.start) hi = mid - 1;
      else if (pos > r.end) lo = mid + 1;
      else return r.seq[pos - r.start]?.toUpperCase() ?? null;
    }
    return null;
  }

  /** The sequence of [start, end], or null if any base is missing. */
  slice(start: number, end: number): string | null {
    let out = '';
    for (let p = start; p <= end; p++) {
      const b = this.base(p);
      if (!b) return null;
      out += b;
    }
    return out;
  }
}

export interface CodonPosition {
  /** 0-based offset along the coding sequence. */
  cdsOffset: number;
  /** 1-based residue number. */
  residue: number;
  /** Which base of the codon this position is: 0, 1 or 2. */
  offsetInCodon: number;
  /** The three genomic positions of the codon, in transcript order. */
  codonPositions: [number, number, number];
}

function blocks(tx: CodingTranscript) {
  const b = tx.cds_starts.map((start, i) => ({ start, end: tx.cds_ends[i]!, frame: tx.cds_frames[i] ?? 0 }));
  b.sort((x, y) => x.start - y.start);
  return tx.strand === '-' ? b.reverse() : b; // transcript order
}

/** Where a genomic position falls in a transcript's coding sequence. */
export function codonAt(tx: CodingTranscript, pos: number): CodonPosition | null {
  const ordered = blocks(tx);
  if (ordered.length === 0) return null;
  const startFrame = ordered[0]!.frame; // bases before the first whole codon
  let offset = 0;
  let found = -1;
  for (const b of ordered) {
    const len = b.end - b.start + 1;
    if (pos >= b.start && pos <= b.end) {
      found = offset + (tx.strand === '-' ? b.end - pos : pos - b.start);
      break;
    }
    offset += len;
  }
  if (found < 0) return null;
  const coding = found - startFrame;
  if (coding < 0) return null; // in the incomplete first codon
  const residue = Math.floor(coding / 3) + 1;
  const offsetInCodon = coding % 3;
  const positions = [0, 1, 2].map((i) => genomicAt(tx, startFrame + (residue - 1) * 3 + i));
  if (positions.some((p) => p === null)) return null;
  return { cdsOffset: coding, residue, offsetInCodon, codonPositions: positions as [number, number, number] };
}

/** The genomic position of a coding-sequence offset (0-based, including any start frame). */
export function genomicAt(tx: CodingTranscript, cdsOffset: number): number | null {
  let remaining = cdsOffset;
  for (const b of blocks(tx)) {
    const len = b.end - b.start + 1;
    if (remaining < len) return tx.strand === '-' ? b.end - remaining : b.start + remaining;
    remaining -= len;
  }
  return null;
}

export type ConsequenceKind = 'synonymous' | 'missense' | 'nonsense' | 'stop-lost' | 'start-lost' | 'unknown';

export interface Consequence {
  transcriptId: string | null;
  residue: number;
  refCodon: string;
  altCodon: string;
  refAa: string;
  altAa: string;
  kind: ConsequenceKind;
  /** HGVS-style protein notation, e.g. p.Ala222Val or p.Arg642= for a synonymous change. */
  hgvsP: string;
  /** The allele as it reads on the transcript's strand. */
  altOnTranscript: string;
}

/**
 * What one alternate allele does to the protein. `altBase` is on the plus
 * strand, as calls are stored; it is complemented here for minus-strand genes.
 */
export function consequenceOf(
  tx: CodingTranscript,
  sequence: SequenceIndex,
  pos: number,
  altBase: string,
  code: GeneticCode = tx.chrom === 'MT' ? 'vertebrate-mitochondrial' : 'standard',
): Consequence | null {
  const at = codonAt(tx, pos);
  if (!at) return null;
  const bases = at.codonPositions.map((p) => sequence.base(p));
  if (bases.some((b) => !b)) return null;
  const onStrand = (b: string) => (tx.strand === '-' ? complement(b) : b);
  const refCodon = bases.map((b) => onStrand(b!)).join('');
  const altCodonChars = [...refCodon];
  altCodonChars[at.offsetInCodon] = onStrand(altBase.toUpperCase());
  const altCodon = altCodonChars.join('');
  const refAa = translateCodon(refCodon, code);
  const altAa = translateCodon(altCodon, code);
  if (!refAa || !altAa) return null;
  const kind: ConsequenceKind =
    refAa === altAa ? 'synonymous'
    : altAa === '*' ? 'nonsense'
    : refAa === '*' ? 'stop-lost'
    : at.residue === 1 ? 'start-lost'
    : 'missense';
  const hgvsP =
    kind === 'synonymous'
      ? `p.${aaThreeLetter(refAa)}${at.residue}=`
      : `p.${aaThreeLetter(refAa)}${at.residue}${aaThreeLetter(altAa)}`;
  return {
    transcriptId: tx.transcript_id,
    residue: at.residue,
    refCodon,
    altCodon,
    refAa,
    altAa,
    kind,
    hgvsP,
    altOnTranscript: onStrand(altBase.toUpperCase()),
  };
}

export const CONSEQUENCE_WORDS: Record<ConsequenceKind, string> = {
  synonymous: 'the same amino acid (the protein sequence does not change)',
  missense: 'a different amino acid',
  nonsense: 'a stop where an amino acid was, so the protein ends early',
  'stop-lost': 'an amino acid where the stop was, so the protein runs on',
  'start-lost': 'the starting amino acid',
  unknown: 'an unknown change',
};

/** The coding sequence of a transcript, read from the sequence pack. */
export function codingSequence(tx: CodingTranscript, sequence: SequenceIndex): string | null {
  const parts: string[] = [];
  for (const b of blocks(tx)) {
    const s = sequence.slice(b.start, b.end);
    if (s === null) return null;
    parts.push(tx.strand === '-' ? reverseComplement(s) : s);
  }
  const startFrame = blocks(tx)[0]?.frame ?? 0;
  return parts.join('').slice(startFrame);
}
