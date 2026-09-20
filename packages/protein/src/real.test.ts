import { describe, expect, it } from 'vitest';
import mthfr from './fixtures/mthfr.json';
import { SequenceIndex, codingSequence, consequenceOf, translateCodon, type CodingTranscript, type SequenceRange } from './index';

/**
 * Real reference data (GENCODE CDS blocks and GRCh37 bases for MTHFR, a
 * minus-strand gene) against a variant whose protein change is textbook:
 * rs1801133, chr1:11,856,378 G>A, known as MTHFR C677T / p.Ala222Val.
 */
const tx = mthfr.transcript as unknown as CodingTranscript;
const seq = new SequenceIndex(mthfr.sequence as unknown as SequenceRange[]);

describe('MTHFR rs1801133 on real reference data', () => {
  it('reads a coding sequence that starts with ATG and ends in a stop', () => {
    const cds = codingSequence(tx, seq)!;
    expect(cds.slice(0, 3)).toBe('ATG');
    expect(cds.length % 3).toBe(0);
    expect(translateCodon(cds.slice(-3))).toBe('*');
  });

  it('calls the change p.Ala222Val', () => {
    const c = consequenceOf(tx, seq, 11_856_378, 'A')!;
    expect(c).toMatchObject({ kind: 'missense', residue: 222, refAa: 'A', altAa: 'V', hgvsP: 'p.Ala222Val' });
    // The gene is on the minus strand, so the plus-strand A reads as T here.
    expect(c.altOnTranscript).toBe('T');
    expect(c.refCodon).toBe('GCC');
    expect(c.altCodon).toBe('GTC');
  });
});
