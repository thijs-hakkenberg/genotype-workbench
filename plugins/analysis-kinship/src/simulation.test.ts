/**
 * Does the analysis recover a relationship it was never told?
 *
 * The unit tests check the pieces against hand-written loci. This one builds
 * families by simulating meiosis over a genetic map, so the truth is known by
 * construction, and then asks the analysis what it sees. It is the only test
 * here that can catch an estimator that is self-consistent but wrong.
 */
import { describe, expect, it } from 'vitest';
import { kinship, type SharedLocus } from './index';

/** Deterministic PRNG, so a failure is always the same failure. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// GRCh37 chromosome map lengths in centimorgans, roughly, summing to ~3545.
const CHROM_CM = [281, 264, 224, 214, 209, 194, 187, 169, 167, 174, 160, 175, 126, 120, 133, 131, 129, 124, 110, 98, 60, 58];
const PER_CM = 25;

interface Site {
  chrom: string;
  cm: number;
  freq: number;
}

function sites(random: () => number): Site[] {
  const out: Site[] = [];
  CHROM_CM.forEach((len, i) => {
    const n = Math.round(len * PER_CM);
    for (let k = 0; k < n; k++) {
      out.push({ chrom: String(i + 1), cm: (k * len) / (n - 1), freq: 0.1 + random() * 0.4 });
    }
  });
  return out;
}

type Haplotype = Uint8Array;
interface Person {
  a: Haplotype;
  b: Haplotype;
}

const founder = (s: Site[], random: () => number): Person => ({
  a: Uint8Array.from(s, (site) => (random() < site.freq ? 1 : 0)),
  b: Uint8Array.from(s, (site) => (random() < site.freq ? 1 : 0)),
});

/** One gamete, switching copies at the map's recombination rate (Haldane). */
function gamete(p: Person, s: Site[], random: () => number): Haplotype {
  const out = new Uint8Array(s.length);
  let current = random() < 0.5 ? 0 : 1;
  for (let i = 0; i < s.length; i++) {
    if (i === 0 || s[i]!.chrom !== s[i - 1]!.chrom) {
      current = random() < 0.5 ? 0 : 1; // chromosomes assort independently
    } else {
      const d = s[i]!.cm - s[i - 1]!.cm;
      if (random() < (1 - Math.exp((-2 * d) / 100)) / 2) current ^= 1;
    }
    out[i] = (current === 0 ? p.a : p.b)[i]!;
  }
  return out;
}

const child = (f: Person, m: Person, s: Site[], random: () => number): Person => ({
  a: gamete(f, s, random),
  b: gamete(m, s, random),
});

/** What the two chips would report at every site. */
function compare(x: Person, y: Person, s: Site[]): SharedLocus[] {
  return s.map((site, i) => {
    const xs = x.a[i]! + x.b[i]!; // 0, 1 or 2 copies of the alternate allele
    const ys = y.a[i]! + y.b[i]!;
    const ibs = xs === ys ? 2 : Math.abs(xs - ys) === 2 ? 0 : 1;
    return {
      chrom: site.chrom,
      pos: Math.round(site.cm * 1_000_000),
      cm: site.cm,
      ibs: ibs as 0 | 1 | 2,
      het_a: xs === 1,
      het_b: ys === 1,
    };
  });
}

function family(seed: number) {
  const random = rng(seed);
  const s = sites(random);
  const father = founder(s, random);
  const mother = founder(s, random);
  const other = founder(s, random);
  const kid = child(father, mother, s, random);
  return {
    s,
    random,
    father,
    mother,
    other,
    kid,
    sibling: child(father, mother, s, random),
    halfSibling: child(father, other, s, random),
  };
}

describe('against simulated families', () => {
  const f = family(20260920);

  it('reads a parent and child as a parent and child', () => {
    const result = kinship(compare(f.father, f.kid, f.s));
    expect(result.coefficient.ibs0Rate).toBe(0);
    expect(result.coefficient.phi).toBeGreaterThan(0.2);
    expect(result.candidates.map((c) => c.label)).toEqual(['parent or child']);
  });

  it('reads full siblings as full siblings, not as a parent', () => {
    const result = kinship(compare(f.kid, f.sibling, f.s));
    expect(result.coefficient.ibs0Rate).toBeGreaterThan(0);
    expect(result.coefficient.phi).toBeGreaterThan(0.15);
    expect(result.candidates.map((c) => c.label)).toContain('full sibling');
    expect(result.candidates.map((c) => c.label)).not.toContain('parent or child');
  });

  it('reads half siblings as a second-degree relationship', () => {
    const result = kinship(compare(f.kid, f.halfSibling, f.s));
    expect(result.candidates.map((c) => c.degree)).toContain(2);
    expect(result.candidates.map((c) => c.label)).toContain('half sibling');
  });

  it('claims no relationship between two founders', () => {
    const result = kinship(compare(f.father, f.mother, f.s));
    expect(result.coefficient.phi).toBeLessThan(0.05);
    expect(result.candidates).toEqual([]);
  });

  it('finds a parent and child sharing essentially the whole genome, in few pieces', () => {
    const result = kinship(compare(f.mother, f.kid, f.s));
    // One unbroken half-identical stretch per chromosome, and nothing missing.
    expect(result.totalCm).toBeGreaterThan(3300);
    expect(result.segments.length).toBe(CHROM_CM.length);
  });

  it('finds siblings sharing about three quarters of the genome', () => {
    const result = kinship(compare(f.kid, f.sibling, f.s));
    expect(result.totalCm).toBeGreaterThan(2200);
    expect(result.totalCm).toBeLessThan(3400);
  });
});
