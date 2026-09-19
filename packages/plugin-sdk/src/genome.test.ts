import { describe, expect, it } from 'vitest';
import { clampRegion, formatRegion, parseRegion } from './genome';

describe('region parsing', () => {
  it('reads the formats people paste', () => {
    expect(parseRegion('chr2:136,600,000-136,620,000')).toEqual({ chrom: '2', start: 136_600_000, end: 136_620_000 });
    expect(parseRegion('2:136600000-136620000')).toEqual({ chrom: '2', start: 136_600_000, end: 136_620_000 });
    expect(parseRegion('chrX')).toEqual({ chrom: 'X', start: 1, end: 155_270_560 });
    expect(parseRegion('chrM:100')?.chrom).toBe('MT');
    expect(parseRegion('2:1000', 1000)).toEqual({ chrom: '2', start: 500, end: 1500 });
    expect(parseRegion('rs4988235')).toBeNull();
    expect(parseRegion('chr23:1')).toBeNull();
  });

  it('keeps regions on the chromosome', () => {
    expect(clampRegion({ chrom: '21', start: 48_129_000, end: 48_140_000 })).toEqual({ chrom: '21', start: 48_118_895, end: 48_129_895 });
    expect(clampRegion({ chrom: '1', start: -50, end: 100 }).start).toBe(1);
  });

  it('formats with the en dash', () => {
    expect(formatRegion({ chrom: '2', start: 136_600_000, end: 136_620_000 })).toBe('chr2:136,600,000–136,620,000');
  });
});
