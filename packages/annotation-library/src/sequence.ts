/**
 * The sequence and protein scales.
 *
 * Both read only reference packs: the bases at this position, and the codon a
 * transcript makes of them. What the kit carries is joined in the view, not here.
 */
import type { Chrom, Region, TrackItem } from '@gw/plugin-sdk';
import { SequenceIndex, codonAt, translateCodon, type CodingTranscript, type SequenceRange } from '@gw/protein';
import type { GeneRow } from './rows';

export interface SequenceItemRow extends SequenceRange {}

/** One codon of a transcript, with the genomic blocks it occupies. */
export interface CodonRow {
  transcriptId: string | null;
  transcriptName: string | null;
  symbol: string;
  residue: number;
  aa: string;
  codon: string;
  strand: '+' | '-';
  /** Genomic [start, end] blocks; two when the codon crosses an exon boundary. */
  blocks: [number, number][];
}

/** The transcript a coding position belongs to: canonical first, then longest CDS. */
export function pickTranscript(genes: GeneRow[]): (GeneRow & CodingTranscript) | null {
  const coding = genes.filter((g) => (g.cds_starts?.length ?? 0) > 0) as (GeneRow & CodingTranscript)[];
  if (coding.length === 0) return null;
  const span = (g: GeneRow & CodingTranscript) => g.cds_ends.reduce((n, e, i) => n + e - g.cds_starts[i]!, 0);
  return coding.sort((a, b) => Number(b.canonical ?? false) - Number(a.canonical ?? false) || span(b) - span(a))[0]!;
}

/** Codons of one transcript overlapping a region, as track items. */
export function codonItems(tx: GeneRow & CodingTranscript, sequence: SequenceIndex, region: Region): TrackItem<CodonRow>[] {
  const items: TrackItem<CodonRow>[] = [];
  const seen = new Set<number>();
  const from = Math.max(region.start, Math.min(...tx.cds_starts));
  const to = Math.min(region.end, Math.max(...tx.cds_ends));
  for (let pos = from; pos <= to; pos++) {
    const at = codonAt(tx, pos);
    if (!at || seen.has(at.residue)) continue;
    seen.add(at.residue);
    const positions = [...at.codonPositions].sort((a, b) => a - b);
    const bases = at.codonPositions.map((p) => sequence.base(p));
    if (bases.some((b) => !b)) continue;
    const codon = bases
      .map((b) => (tx.strand === '-' ? ({ A: 'T', T: 'A', C: 'G', G: 'C' })[b!] ?? 'N' : b!))
      .join('');
    const aa = translateCodon(codon, tx.chrom === 'MT' ? 'vertebrate-mitochondrial' : 'standard') ?? 'X';
    const blocks: [number, number][] = [];
    for (const p of positions) {
      const last = blocks.at(-1);
      if (last && p === last[1] + 1) last[1] = p;
      else blocks.push([p, p]);
    }
    items.push({
      id: `${tx.transcript_id}:${at.residue}`,
      start: positions[0]!,
      end: positions[2]!,
      label: aa,
      row: {
        transcriptId: tx.transcript_id,
        transcriptName: tx.transcript_name ?? null,
        symbol: tx.symbol,
        residue: at.residue,
        aa,
        codon,
        strand: tx.strand,
        blocks,
      },
    });
  }
  return items;
}

export function sequenceItems(rows: SequenceRange[], chrom: Chrom): TrackItem<SequenceItemRow>[] {
  return rows.map((r) => ({ id: `${chrom}:${r.start}`, start: r.start, end: r.end, row: r }));
}
