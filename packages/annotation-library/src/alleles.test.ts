import { describe, expect, it } from 'vitest';
import { relateAllele } from './alleles';

const call = (a1: string, a2: string | null) => ({ a1, a2, is_nocall: false });

describe('relateAllele', () => {
  it('reads an allele reported on the other strand as its plus-strand complement', () => {
    // GRCh37 ref C, call T/T; study reports its allele as A (i.e. T on the plus strand)
    expect(relateAllele('A', call('T', 'T'), ['C'])).toEqual({ plus: 'T', basis: 'complement', copies: 2 });
    expect(relateAllele('G', call('C', 'T'), ['C'])).toEqual({ plus: 'C', basis: 'complement', copies: 1 });
  });

  it('keeps a plus-strand allele as reported', () => {
    expect(relateAllele('T', call('C', 'T'), ['C'])).toEqual({ plus: 'T', basis: 'plus', copies: 1 });
    expect(relateAllele('T', call('C', 'C'), ['C', 'T'])).toEqual({ plus: 'T', basis: 'plus', copies: 0 });
  });

  it('refuses to guess on A/T and C/G sites', () => {
    expect(relateAllele('A', call('A', 'T'), ['A']).basis).toBe('ambiguous');
    expect(relateAllele('G', call('C', 'C'), ['C']).basis).toBe('ambiguous');
  });

  it('marks alleles that fit neither strand', () => {
    expect(relateAllele('A', call('C', 'C'), ['C'])).toEqual({ plus: 'A', basis: 'unplaced', copies: 0 });
    expect(relateAllele('A', { a1: null, a2: null, is_nocall: true }, ['C']).copies).toBeNull();
  });
});
