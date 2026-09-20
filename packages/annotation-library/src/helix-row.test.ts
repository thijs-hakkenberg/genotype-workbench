import { describe, expect, it } from 'vitest';
import { helixRow } from './rows';

describe('what the molecule carries', () => {
  it('draws your own base where both copies agree', () => {
    expect(helixRow('A', 'G', 'G', false)).toEqual({ base: 'A', call: 'G', drawn: 'G', state: 'measured' });
  });

  it('refuses to place either base where the two copies differ', () => {
    // Chip data is unphased: putting one of them on this molecule would be a
    // guess about which parent it came from.
    const row = helixRow('A', 'A', 'G', false);
    expect(row.state).toBe('heterozygous');
    expect(row.drawn).toBe('A');
    expect(row.call).toBe('AG');
  });

  it('treats a haploid call as measured, because there is only one copy', () => {
    expect(helixRow('T', 'C', null, false).state).toBe('measured');
    expect(helixRow('T', 'C', null, false).drawn).toBe('C');
  });

  it('falls back to the reference where the chip read nothing', () => {
    expect(helixRow('C', null, null, false)).toEqual({ base: 'C', call: null, drawn: 'C', state: 'reference' });
    expect(helixRow('C', 'A', 'A', true).state).toBe('no-call');
    expect(helixRow('C', 'A', 'A', true).drawn).toBe('C');
  });

  it('ignores an indel call, which has no base to draw', () => {
    expect(helixRow('G', 'I', 'D', false).state).toBe('reference');
    expect(helixRow('G', 'I', 'D', false).drawn).toBe('G');
  });
});
