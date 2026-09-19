import { describe, expect, it } from 'vitest';
import { mtHaplogroup, yHaplogroup, type MtNode, type YNode } from './index';

// A toy mtDNA tree relative to rCRS: root R -> A (100G) -> A1 (200T), A2 (300C); R -> B (400A)
const mt: MtNode[] = [
  { name: 'R', parent: null, depth: 0, polys: [], weights: [] },
  { name: 'A', parent: 'R', depth: 1, polys: ['100G'], weights: [2] },
  { name: 'A1', parent: 'A', depth: 2, polys: ['200T'], weights: [1] },
  { name: 'A2', parent: 'A', depth: 2, polys: ['300C'], weights: [1] },
  { name: 'B', parent: 'R', depth: 1, polys: ['400A'], weights: [1] },
];
const rcrs: Record<number, string> = { 100: 'A', 200: 'C', 300: 'T', 400: 'G' };
const mtCalls = (alleles: Record<number, string | null>) =>
  Object.entries(alleles).map(([p, a]) => ({ pos: Number(p), allele: a, ref: rcrs[Number(p)] ?? null }));

describe('mtHaplogroup', () => {
  it('finds the deepest fully supported branch', () => {
    const r = mtHaplogroup(mt, mtCalls({ 100: 'G', 200: 'T', 300: 'T', 400: 'G' }));
    expect(r.best).toBe('A1');
    expect(r.path.map((s) => s.name)).toEqual(['R', 'A', 'A1']);
    expect(r.path[2]!.markers[0]).toEqual({ label: '200T', state: 'derived' });
  });

  it('falls back to the shared branch when the chip cannot tell children apart', () => {
    const r = mtHaplogroup(mt, mtCalls({ 100: 'G', 200: null, 300: null, 400: 'G' }));
    expect(r.best).toBe('A');
    expect(r.note).toMatch(/equally well/);
  });

  it('reports no result without mitochondrial calls', () => {
    expect(mtHaplogroup(mt, []).best).toBeNull();
  });
});

const y: YNode[] = [
  { name: 'Root', parent: null, depth: 0, snp_names: [], pos: [], anc: [], der: [] },
  { name: 'R', parent: 'Root', depth: 1, snp_names: ['M207'], pos: [1000], anc: ['A'], der: ['G'] },
  { name: 'R1b', parent: 'R', depth: 2, snp_names: ['M343'], pos: [2000], anc: ['C'], der: ['A'] },
  { name: 'R1b-U106', parent: 'R1b', depth: 3, snp_names: ['U106'], pos: [3000], anc: ['C'], der: ['T'] },
  { name: 'I', parent: 'Root', depth: 1, snp_names: ['M170'], pos: [4000], anc: ['A'], der: ['C'] },
];
const yCalls = (alleles: Record<number, string>) => Object.entries(alleles).map(([p, a]) => ({ pos: Number(p), allele: a, ref: null }));

describe('yHaplogroup', () => {
  it('follows derived calls to the deepest supported node', () => {
    const r = yHaplogroup(y, yCalls({ 1000: 'G', 2000: 'A', 3000: 'T', 4000: 'A' }));
    expect(r.best).toBe('R1b-U106');
  });

  it('stops where the kit is ancestral', () => {
    expect(yHaplogroup(y, yCalls({ 1000: 'G', 2000: 'A', 3000: 'C' })).best).toBe('R1b');
  });

  it('explains an empty Y without guessing', () => {
    const r = yHaplogroup(y, []);
    expect(r.best).toBeNull();
    expect(r.note).toMatch(/no Y calls/);
  });
});
