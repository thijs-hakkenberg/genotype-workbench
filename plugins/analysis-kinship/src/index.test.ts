import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPTIONS,
  kinship,
  kinshipCoefficient,
  relationshipCandidates,
  sharedSegments,
  type SharedLocus,
} from './index';

/**
 * Loci one centimorgan apart on one chromosome, from a string of IBS states:
 * "1110111" is seven loci with one opposite homozygote in the middle.
 */
function loci(states: string, chrom = '1', cmStep = 1): SharedLocus[] {
  return [...states].map((s, i) => ({
    chrom,
    pos: 1_000_000 + i * 100_000,
    cm: i * cmStep,
    ibs: Number(s) as 0 | 1 | 2,
    het_a: false,
    het_b: false,
  }));
}

const loose = { ...DEFAULT_OPTIONS, minSnps: 3 };

describe('sharedSegments', () => {
  it('finds a run of matching loci', () => {
    const segs = sharedSegments(loci('1'.repeat(11)), loose);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.cm).toBe(10);
    expect(segs[0]!.snps).toBe(11);
  });

  it('rejects a run shorter than the minimum length', () => {
    expect(sharedSegments(loci('1'.repeat(5)), loose)).toEqual([]);
  });

  it('rejects a long run carried by too few markers', () => {
    // Four loci spanning 30 cM: long enough, but far too sparse to believe.
    expect(sharedSegments(loci('1111', '1', 10), { ...DEFAULT_OPTIONS, minSnps: 10 })).toEqual([]);
  });

  it('tolerates a lone mismatch as a misread', () => {
    const segs = sharedSegments(loci('1'.repeat(10) + '0' + '1'.repeat(10)), loose);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.snps).toBe(21);
  });

  it('believes two mismatches in a row', () => {
    const segs = sharedSegments(loci('1'.repeat(10) + '00' + '1'.repeat(10)), loose);
    expect(segs).toHaveLength(2);
  });

  it('marks an end a mismatch bounds as known, and one that runs out of chip as unknown', () => {
    const segs = sharedSegments(loci('1'.repeat(10) + '00' + '1'.repeat(10)), loose);
    // First segment: starts at the chromosome edge, ends at a real mismatch.
    expect(segs[0]!.startKnown).toBe(false);
    expect(segs[0]!.endKnown).toBe(true);
    // Second: starts after the mismatch, runs off the end of the data.
    expect(segs[1]!.startKnown).toBe(true);
    expect(segs[1]!.endKnown).toBe(false);
  });

  it('never runs a segment across two chromosomes', () => {
    const segs = sharedSegments([...loci('1'.repeat(10), '1'), ...loci('1'.repeat(10), '2')], loose);
    expect(segs).toHaveLength(2);
    expect(segs.map((s) => s.chrom)).toEqual(['1', '2']);
    // Neither end is a real boundary: both simply ran out of chromosome.
    expect(segs.every((s) => !s.endKnown)).toBe(true);
  });

  it('falls back to base pairs when no genetic map is installed', () => {
    const unmapped = loci('1'.repeat(101)).map((l) => ({ ...l, cm: null }));
    const segs = sharedSegments(unmapped, loose);
    expect(segs[0]!.cmEstimated).toBe(true);
    expect(segs[0]!.cm).toBeCloseTo(10, 5); // 100 gaps of 100 kb
  });
});

describe('kinshipCoefficient', () => {
  const pair = (hetA: boolean, hetB: boolean, ibs: 0 | 1 | 2, n: number): SharedLocus[] =>
    Array.from({ length: n }, (_, i) => ({ chrom: '1', pos: i, cm: i, ibs, het_a: hetA, het_b: hetB }));

  it('reads identical samples as a coefficient of one half', () => {
    expect(kinshipCoefficient(pair(true, true, 2, 100)).phi).toBeCloseTo(0.5, 5);
  });

  it('reads no shared heterozygosity and many opposite homozygotes as unrelated', () => {
    const rows = [...pair(true, true, 2, 100), ...pair(false, false, 0, 50)];
    expect(kinshipCoefficient(rows).phi).toBeCloseTo(0, 1);
  });

  it('reports the opposite-homozygote rate over every locus', () => {
    const rows = [...pair(false, false, 1, 90), ...pair(false, false, 0, 10)];
    expect(kinshipCoefficient(rows).ibs0Rate).toBeCloseTo(0.1, 5);
  });
});

describe('relationshipCandidates', () => {
  it('calls a full genome of sharing with no mismatches a parent or child', () => {
    expect(relationshipCandidates(3500, 0).map((c) => c.label)).toEqual(['parent or child']);
  });

  it('separates a full sibling from a parent on mismatches alone', () => {
    // Almost the same total, opposite conclusions.
    expect(relationshipCandidates(3350, 0).map((c) => c.label)).toEqual(['parent or child']);
    expect(relationshipCandidates(3350, 0.014).map((c) => c.label)).toEqual(['full sibling']);
  });

  it('offers every relationship a second-degree total is consistent with', () => {
    const labels = relationshipCandidates(1750, 0.02).map((c) => c.label);
    expect(labels).toContain('half sibling');
    expect(labels).toContain('grandparent or grandchild');
    expect(labels).toContain('aunt or uncle, niece or nephew');
  });

  it('offers nothing when the sharing is below the closest band', () => {
    expect(relationshipCandidates(40, 0.06)).toEqual([]);
  });
});

describe('kinship', () => {
  it('says when the chips are too sparse for segments to mean anything', () => {
    // Ten loci across 100 cM: one marker every 10 cM.
    const result = kinship(loci('1'.repeat(10), '1', 10));
    expect(result.tooSparse).toBe(true);
    expect(result.notes[0]).toMatch(/too few to tell a real shared stretch from a run of coincidences/);
  });

  it('scales the marker minimum to the density of the chips', () => {
    // 3000 loci over 100 cM is 30 markers per cM; 0.3 x 30 x 7 = 63.
    const dense = kinship(loci('1'.repeat(3000), '1', 100 / 2999));
    expect(dense.options.minSnps).toBe(63);
    expect(dense.tooSparse).toBe(false);
  });

  it('measures density over the whole comparison, not the corner the map covers', () => {
    // 2,000 loci spread over 200 Mb, of which the map places only the first 50
    // across 2 cM. Measured over that corner alone the pair would look finely
    // resolved; measured honestly it is nothing of the sort.
    const all = Array.from({ length: 2000 }, (_, i) => ({
      chrom: '1',
      pos: 1 + i * 100_000,
      cm: i < 50 ? i * 0.04 : null,
      ibs: 1 as const,
      het_a: false,
      het_b: false,
    }));
    const result = kinship(all);
    expect(result.mapCoverage).toBeCloseTo(0.025, 3);
    expect(result.markersPerCm).toBeLessThan(20);
    expect(result.tooSparse).toBe(true);
    expect(result.notes.join(' ')).toMatch(/places 3% of the positions compared/);
  });

  it('always states that the match is half-identical and that ranges overlap', () => {
    const result = kinship(loci('1'.repeat(100)));
    expect(result.notes.join(' ')).toMatch(/half-identical/);
    expect(result.notes.join(' ')).toMatch(/Ranges overlap between relationships/);
    expect(result.notes.join(' ')).toMatch(/endogamous/);
  });
});
