import { describe, expect, it } from 'vitest';
import { SequenceIndex, codingSequence, codonAt, consequenceOf, translateCodon } from './index';

//  A two-exon transcript on the plus strand.
//  Genome:        pos 101..106 = ATG AAA (exon 1), pos 201..206 = CGT TGA (exon 2)
const plus = {
  transcript_id: 'ENST1',
  chrom: '1' as const,
  strand: '+' as const,
  cds_starts: [101, 201],
  cds_ends: [106, 206],
  cds_frames: [0, 0],
};
const seq = new SequenceIndex([
  { chrom: '1', start: 101, end: 106, seq: 'ATGAAA' },
  { chrom: '1', start: 201, end: 206, seq: 'CGTTGA' },
]);

describe('codon mapping', () => {
  it('places positions in codons across exons', () => {
    expect(codonAt(plus, 101)).toMatchObject({ residue: 1, offsetInCodon: 0, codonPositions: [101, 102, 103] });
    expect(codonAt(plus, 106)).toMatchObject({ residue: 2, offsetInCodon: 2 });
    expect(codonAt(plus, 201)).toMatchObject({ residue: 3, offsetInCodon: 0, codonPositions: [201, 202, 203] });
    expect(codonAt(plus, 150)).toBeNull(); // intron
  });

  it('reads the coding sequence back', () => {
    expect(codingSequence(plus, seq)).toBe('ATGAAACGTTGA');
  });
});

describe('consequences on the plus strand', () => {
  it('names a missense change', () => {
    const c = consequenceOf(plus, seq, 202, 'A')!; // CGT -> CAT, Arg -> His
    expect(c).toMatchObject({ kind: 'missense', refAa: 'R', altAa: 'H', residue: 3, hgvsP: 'p.Arg3His' });
  });

  it('names a synonymous change', () => {
    const c = consequenceOf(plus, seq, 203, 'C')!; // CGT -> CGC, both Arg
    expect(c).toMatchObject({ kind: 'synonymous', hgvsP: 'p.Arg3=' });
  });

  it('names a new stop', () => {
    const c = consequenceOf(plus, seq, 201, 'T')!; // CGT -> TGT? no: C->T gives TGT (Cys)
    expect(c.kind).toBe('missense');
    const stop = consequenceOf(plus, seq, 104, 'T')!; // AAA -> TAA, a stop
    expect(stop).toMatchObject({ kind: 'nonsense', hgvsP: 'p.Lys2Ter' });
  });
});

// The same gene on the minus strand: the transcript reads 206..201 then 106..101,
// complemented. Coding sequence is TCAACG TTTCAT.
const minus = { ...plus, transcript_id: 'ENST2', strand: '-' as const };

describe('consequences on the minus strand', () => {
  it('reads the transcript in reverse complement', () => {
    expect(codingSequence(minus, seq)).toBe('TCAACGTTTCAT');
    expect(codonAt(minus, 206)).toMatchObject({ residue: 1, offsetInCodon: 0 });
  });

  it('complements the call before translating', () => {
    // Residue 2 is ACG (Thr) at 203..201; a plus-strand C at 202 is G on the transcript: AGG = Arg
    const c = consequenceOf(minus, seq, 202, 'C')!;
    expect(c).toMatchObject({ kind: 'missense', refAa: 'T', altAa: 'R', altOnTranscript: 'G' });
  });
});

describe('the mitochondrial code differs', () => {
  it('reads TGA as tryptophan on MT, and as a stop elsewhere', () => {
    expect(translateCodon('TGA')).toBe('*');
    expect(translateCodon('TGA', 'vertebrate-mitochondrial')).toBe('W');
    expect(translateCodon('AGA', 'vertebrate-mitochondrial')).toBe('*');
    // Residue 4 is TGA: a stop in the standard code, tryptophan on MT.
    const mt = { ...plus, chrom: 'MT' as const };
    const c = consequenceOf(mt, seq, 204, 'A')!; // TGA -> AGA, which is a stop on MT
    expect(c).toMatchObject({ refAa: 'W', altAa: '*', kind: 'nonsense', hgvsP: 'p.Trp4Ter' });
    // The same change outside MT starts from a stop instead.
    expect(consequenceOf(plus, seq, 204, 'A')!.refAa).toBe('*');
  });
});

describe('an incomplete first codon is skipped', () => {
  it('starts counting at the first whole codon', () => {
    const shifted = { ...plus, cds_frames: [1, 0] };
    expect(codonAt(shifted, 101)).toBeNull();
    expect(codonAt(shifted, 102)).toMatchObject({ residue: 1, offsetInCodon: 0 });
  });
});
