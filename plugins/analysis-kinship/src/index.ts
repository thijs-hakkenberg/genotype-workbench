/**
 * analysis-kinship: what two people's chips have in common, and what that is
 * consistent with.
 *
 * Everything here is a pure function over loci both kits called. The host does
 * the reading and the consent; this module never touches storage or the
 * network, so it can be tested against a handful of hand-written loci.
 *
 * Three things it deliberately does not do. It does not name one relationship:
 * shared DNA is consistent with several, and the overlap is a fact about
 * inheritance rather than a shortcoming of the method. It does not phase:
 * chip data is unphased, so a shared stretch is *half*-identical — the two
 * people match on one copy, and which parent it came from is unknown until a
 * parent's kit is present. And it does not correct for endogamy, which inflates
 * shared centimorgans; the note says so rather than silently adjusting.
 */
import type { PluginManifest } from '@gw/plugin-sdk';
import manifestJson from '../manifest.json';

export const manifest = manifestJson as PluginManifest;

/** One locus both kits called. Mirrors the row the host's query returns. */
export interface SharedLocus {
  chrom: string;
  pos: number;
  /** Cumulative centimorgans within the chromosome; null where the map is silent. */
  cm: number | null;
  /** Alleles in common: 2, 1, or 0. */
  ibs: 0 | 1 | 2;
  het_a: boolean;
  het_b: boolean;
}

/** A stretch the two kits match across on at least one copy. */
export interface Segment {
  chrom: string;
  start: number;
  end: number;
  cm: number;
  snps: number;
  /**
   * Whether each end is a real boundary.
   *
   * True when an opposite-homozygote locus bounds it: the match demonstrably
   * stops there. False when the run simply ran out of chip — a gap in the
   * markers, or the end of the chromosome — so the true end is somewhere
   * beyond, unknown. Views draw a hard end for the first and a faded one for
   * the second.
   */
  startKnown: boolean;
  endKnown: boolean;
  /** True when no genetic map was available and length is inferred from bases. */
  cmEstimated: boolean;
}

export interface SegmentOptions {
  /** Shortest run worth reporting. Seven centimorgans is the usual convention. */
  minCm: number;
  /** Fewest markers a run must contain, so a sparse chip cannot manufacture one. */
  minSnps: number;
  /** Isolated opposite homozygotes tolerated inside a run, as chip error. */
  errorTolerance: number;
}

export const DEFAULT_OPTIONS: SegmentOptions = { minCm: 7, minSnps: 500, errorTolerance: 1 };

/** The autosomal genome, in centimorgans (GRCh37, HapMap II). */
export const AUTOSOMAL_CM = 3545;

export interface Coefficient {
  /** KING-robust kinship coefficient: ~0.25 first degree, ~0 unrelated. */
  phi: number;
  /**
   * Share of loci where the two genotypes have no allele in common.
   *
   * The one measurement that separates a parent from a full sibling: a child
   * inherits one copy from each parent, so parent and child cannot disagree
   * completely anywhere. Siblings can, and do, at around a quarter of the rate
   * of two strangers. Total shared centimorgans cannot tell the two apart.
   */
  ibs0Rate: number;
  loci: number;
}

export interface Candidate {
  label: string;
  /** Degree of relationship: 1 = parent or sibling, 2 = grandparent, and so on. */
  degree: number;
  cmRange: [number, number];
}

export interface KinshipResult {
  totalCm: number;
  longestCm: number;
  segments: Segment[];
  coefficient: Coefficient;
  /** Every relationship the sharing is consistent with. Never just one. */
  candidates: Candidate[];
  loci: number;
  /** Markers per centimorgan: how finely this pair of chips can resolve a segment. */
  markersPerCm: number;
  /** Share of compared loci the genetic map actually places, 0 to 1. */
  mapCoverage: number;
  /** True when the chips are too sparse for segment detection to mean anything. */
  tooSparse: boolean;
  options: SegmentOptions;
  /** What the numbers above cannot tell you, in the words the UI shows. */
  notes: string[];
}

/**
 * Expected sharing per degree of relationship.
 *
 * Expectations are halved per degree from the whole autosomal genome; the
 * bands are the spread that random recombination produces around them, which
 * is why they overlap. A parent and child are the one pair with almost no
 * spread: the child inherits exactly one full copy, every time.
 */
const DEGREES: { degree: number; expected: number; range: [number, number]; labels: string[] }[] = [
  { degree: 1, expected: AUTOSOMAL_CM, range: [3300, 3720], labels: ['parent or child'] },
  { degree: 1, expected: 2655, range: [2200, 3400], labels: ['full sibling'] },
  {
    degree: 2,
    expected: 1770,
    range: [1300, 2300],
    labels: ['half sibling', 'grandparent or grandchild', 'aunt or uncle, niece or nephew'],
  },
  {
    degree: 3,
    expected: 885,
    range: [650, 1150],
    labels: ['first cousin', 'great-grandparent', 'half aunt or uncle'],
  },
  {
    degree: 4,
    expected: 443,
    range: [300, 620],
    labels: ['first cousin once removed', 'half first cousin'],
  },
  { degree: 5, expected: 221, range: [130, 320], labels: ['second cousin'] },
];

/**
 * Find the stretches where the two kits match on at least one copy.
 *
 * A run ends at an opposite-homozygote locus, because two people who inherited
 * a stretch from the same ancestor cannot disagree completely inside it. A
 * single such locus can also be a misread, so one isolated one is tolerated;
 * two in a row are taken at their word.
 */
export function sharedSegments(loci: SharedLocus[], options: SegmentOptions = DEFAULT_OPTIONS): Segment[] {
  const out: Segment[] = [];
  let startIdx: number | null = null;
  let errors = 0;
  let startKnown = false;

  const close = (endIdx: number, endKnown: boolean) => {
    if (startIdx === null) return;
    const first = loci[startIdx]!;
    const last = loci[endIdx]!;
    const snps = endIdx - startIdx + 1;
    const estimated = first.cm === null || last.cm === null;
    const cm = estimated ? (last.pos - first.pos) / 1_000_000 : last.cm! - first.cm!;
    if (cm >= options.minCm && snps >= options.minSnps) {
      out.push({
        chrom: first.chrom,
        start: first.pos,
        end: last.pos,
        cm,
        snps,
        startKnown,
        endKnown,
        cmEstimated: estimated,
      });
    }
    startIdx = null;
    errors = 0;
  };

  for (let i = 0; i < loci.length; i++) {
    const locus = loci[i]!;
    const newChrom = i > 0 && locus.chrom !== loci[i - 1]!.chrom;
    if (newChrom) close(i - 1, false); // the chromosome ended, not the match

    if (locus.ibs === 0) {
      const nextIsAlso = loci[i + 1]?.ibs === 0 && loci[i + 1]?.chrom === locus.chrom;
      if (startIdx !== null && !nextIsAlso && errors < options.errorTolerance) {
        errors++; // a lone mismatch inside a long match is more likely a misread
        continue;
      }
      close(i - 1, true); // a real boundary: the match demonstrably stops here
      continue;
    }
    if (startIdx === null) {
      startIdx = i;
      // Known start only if a mismatch immediately precedes it on this chromosome.
      const prev = loci[i - 1];
      startKnown = !newChrom && !!prev && prev.ibs === 0 && prev.chrom === locus.chrom;
    }
  }
  close(loci.length - 1, false);
  return out;
}

/**
 * The KING-robust kinship coefficient, and the opposite-homozygote rate.
 *
 * Counting heterozygotes rather than segments makes this independent of where
 * the matches fall, so it holds up where segment detection is shaky.
 */
export function kinshipCoefficient(loci: SharedLocus[]): Coefficient {
  let hetHet = 0;
  let ibs0 = 0;
  let hetA = 0;
  let hetB = 0;
  for (const l of loci) {
    if (l.het_a) hetA++;
    if (l.het_b) hetB++;
    if (l.het_a && l.het_b) hetHet++;
    if (l.ibs === 0) ibs0++;
  }
  const denominator = hetA + hetB;
  return {
    phi: denominator === 0 ? 0 : (hetHet - 2 * ibs0) / denominator,
    ibs0Rate: loci.length === 0 ? 0 : ibs0 / loci.length,
    loci: loci.length,
  };
}

/**
 * Which relationships this much sharing is consistent with, strongest first.
 *
 * Returns a list, always. Where the bands overlap, the estimate genuinely
 * cannot choose, and saying so is the correct answer rather than a hedge. The
 * one distinction it can make confidently is parent from sibling, on the
 * opposite-homozygote rate.
 */
export function relationshipCandidates(totalCm: number, ibs0Rate: number): Candidate[] {
  const out: Candidate[] = [];
  for (const d of DEGREES) {
    if (totalCm < d.range[0] || totalCm > d.range[1]) continue;
    // A parent and child share one full copy everywhere, so they never disagree
    // completely. Anything above a hair's breadth rules the relationship out.
    const isParentBand = d.labels[0] === 'parent or child';
    if (isParentBand && ibs0Rate > 0.002) continue;
    if (!isParentBand && d.degree === 1 && ibs0Rate <= 0.002) continue;
    for (const label of d.labels) out.push({ label, degree: d.degree, cmRange: d.range });
  }
  return out;
}

/** The whole analysis: segments, coefficient, candidates, and the caveats. */
export function kinship(loci: SharedLocus[], options?: Partial<SegmentOptions>): KinshipResult {
  const mapped = loci.filter((l) => l.cm !== null);
  const mapCoverage = loci.length === 0 ? 0 : mapped.length / loci.length;

  // Density has to be measured over the whole comparison, not over whichever
  // corner the map happens to cover. A map that places a tenth of the loci
  // would otherwise make a sparse pair of chips look finely resolved.
  const spanCm = mapCoverage >= 0.5 ? chromosomeSpans(mapped) : chromosomeSpans(loci, true);
  const markersPerCm = spanCm > 0 ? loci.length / spanCm : 0;

  // A fixed marker count means different things on different chips, so scale
  // it to how finely this pair actually resolves the map.
  const scaled = Math.round(0.3 * markersPerCm * (options?.minCm ?? DEFAULT_OPTIONS.minCm));
  const opts: SegmentOptions = {
    ...DEFAULT_OPTIONS,
    minSnps: Math.max(20, Math.min(700, scaled || DEFAULT_OPTIONS.minSnps)),
    ...options,
  };

  const segments = sharedSegments(loci, opts);
  const coefficient = kinshipCoefficient(loci);
  const totalCm = segments.reduce((sum, s) => sum + s.cm, 0);
  const longestCm = segments.reduce((max, s) => Math.max(max, s.cm), 0);
  const candidates = relationshipCandidates(totalCm, coefficient.ibs0Rate);

  const notes: string[] = [];
  const tooSparse = markersPerCm > 0 && markersPerCm < 20;
  if (tooSparse) {
    notes.push(
      `These two chips share only ${markersPerCm.toFixed(1)} markers per centimorgan, which is too few to tell a real`
        + ' shared stretch from a run of coincidences. The coefficient below does not depend on segments and still holds.',
    );
  }
  if (mapCoverage < 0.9) {
    notes.push(
      mapCoverage === 0
        ? 'No genetic map places these positions, so lengths are inferred from base pairs at roughly 1 cM per Mb.'
        : `The installed genetic map places ${(mapCoverage * 100).toFixed(0)}% of the positions compared; the rest are`
          + ' measured in base pairs at roughly 1 cM per Mb, which is an approximation.',
    );
  }
  notes.push(
    'Chip data is unphased, so a shared stretch is half-identical: the two match on one copy, and which parent it came'
      + ' from is unknown until a parent\'s kit is present.',
  );
  notes.push(
    'Ranges overlap between relationships because recombination is random, not because the method is imprecise. Where'
      + ' several are listed, the DNA does not distinguish them.',
  );
  notes.push(
    'Shared ancestry within a community inflates these totals, so a pair from an endogamous population will look more'
      + ' closely related than they are.',
  );

  return {
    totalCm,
    longestCm,
    segments,
    coefficient,
    candidates,
    loci: loci.length,
    markersPerCm,
    mapCoverage,
    tooSparse,
    options: opts,
    notes,
  };
}

/**
 * Total length covered, summed per chromosome, in centimorgans.
 *
 * With `fromBases`, distance comes from base pairs at roughly 1 cM per Mb —
 * the fallback for a map that does not reach these positions.
 */
function chromosomeSpans(loci: SharedLocus[], fromBases = false): number {
  const at = (l: SharedLocus) => (fromBases ? l.pos / 1_000_000 : l.cm!);
  let total = 0;
  let first: SharedLocus | null = null;
  let previous: SharedLocus | null = null;
  for (const l of loci) {
    if (!first || l.chrom !== first.chrom) {
      if (first && previous) total += at(previous) - at(first);
      first = l;
    }
    previous = l;
  }
  if (first && previous) total += at(previous) - at(first);
  return total;
}
