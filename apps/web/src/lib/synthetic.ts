/**
 * Generate a profile to try the workbench with, for anyone who has no raw
 * data file — or who would rather not put their own in yet.
 *
 * What comes out is **not anyone's DNA**. It is the GRCh37 reference at the
 * positions consumer chips read, with alleles either left as the reference or
 * drawn at random. It carries its own vendor label, "Synthetic profile", so
 * every surface that names a source says so, and a custody basis of
 * `synthetic`, which means consent does not apply rather than that it was
 * given.
 *
 * It is written as a text file and imported through the ordinary path, so the
 * Rust normalizer checks every base against the reference exactly as it would
 * for a real export. Generating calls straight into storage would skip that,
 * and then the kit would not be comparable with an imported one.
 */
import type { ReferenceColumns } from '@gw/genotype-store';

export type SyntheticMode = 'reference' | 'drawn';

export const SYNTHETIC_MODES: Record<SyntheticMode, { label: string; what: string }> = {
  reference: {
    label: 'The reference everywhere',
    what:
      'Every position carries two copies of the GRCh37 reference base. Nothing differs from the reference, so the'
      + ' annotation pages will be almost empty — which is itself worth seeing, because it is what "no findings" looks like.',
  },
  drawn: {
    label: 'Alleles drawn at random',
    what:
      'Each position is given an alternate allele with a frequency drawn per position, mostly as a transition (A↔G,'
      + ' C↔T) as in real chip data. Nobody has this genome, and it is nobody\'s ancestry: the draws are independent,'
      + ' so the result carries no shared segments, no real haplotypes and no population history. About one position in'
      + ' eighty is left as a no-call, the way a real chip fails to read some.',
  },
};

/** The one alternate base a transition would give. */
const TRANSITION: Record<string, string> = { A: 'G', G: 'A', C: 'T', T: 'C' };
const BASES = 'ACGT';
/** Roughly what a consumer chip fails to read. */
const NO_CALL_RATE = 0.012;
const CHROM_NAME = new Map<number, string>([
  ...Array.from({ length: 22 }, (_, i) => [i + 1, String(i + 1)] as [number, string]),
  [23, 'X'],
  [24, 'Y'],
  [25, 'MT'],
]);

/** Deterministic, so the same seed always gives the same profile. */
function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticOptions {
  mode: SyntheticMode;
  seed: number;
  /** Haploid calls on Y, and on X outside the pseudoautosomal regions. */
  sex: 'male' | 'female';
  onProgress?: (done: number, total: number) => void;
}

/**
 * The header a generated profile carries.
 *
 * It names itself in its first line and never begins the way any vendor's
 * export does, so neither a reader nor the repository's no-genomes guard can
 * mistake one for the other.
 */
export const SYNTHETIC_HEADER = (seed: number, mode: SyntheticMode) =>
  `# Genotype Workbench synthetic profile — generated in a browser, not genotyped.\n`
  + `# Not a person: this is the GRCh37 reference at chip positions, with alleles ${
    mode === 'reference' ? 'left as the reference' : `drawn at random (seed ${seed})`
  }.\n`
  + `# Nobody has this genome, and it carries no ancestry.\n`
  + `# We are using reference human assembly build 37 (GRCh37).\n`
  + `# rsid\tchromosome\tposition\tgenotype\n`;

/**
 * Build the file, in chunks so a million and a half lines never exist as one
 * string.
 *
 * rsIDs are left empty on purpose. An rsID is a name dbSNP gives a position
 * somebody observed; inventing one here would be inventing a citation. The
 * search box still resolves real rsIDs through the installed packs.
 */
export function syntheticFile(reference: ReferenceColumns, options: SyntheticOptions): File {
  const { chrom, pos, base } = reference;
  const total = pos.length;
  const rand = random(options.seed);
  const parts: string[] = [];
  let buffer = SYNTHETIC_HEADER(options.seed, options.mode);

  for (let i = 0; i < total; i++) {
    const name = CHROM_NAME.get(chrom[i]!);
    if (!name) continue;
    const ref = String.fromCharCode(base[i]!).toUpperCase();
    if (!BASES.includes(ref)) continue;

    // One copy where there is only one to have: MT always, and Y and X in a
    // male — the same rule the normalizer applies.
    const haploid = name === 'MT' || (options.sex === 'male' && (name === 'X' || name === 'Y'));
    if (options.sex === 'female' && name === 'Y') continue;

    let genotype: string;
    if (options.mode === 'reference') {
      genotype = haploid ? ref : ref + ref;
    } else if (rand() < NO_CALL_RATE) {
      // Real chips fail to read a small share of positions, and a profile with
      // a perfect call rate would not exercise the pages that report one.
      genotype = '--';
    } else {
      const alt = rand() < 0.97 ? TRANSITION[ref]! : BASES[Math.floor(rand() * 4)]!;
      const frequency = [0.05, 0.2, 0.5][Math.floor(rand() * 3)]!;
      const draw = () => (rand() < frequency ? alt : ref);
      genotype = haploid ? draw() : [draw(), draw()].sort().join('');
    }

    buffer += `\t${name}\t${pos[i]}\t${genotype}\n`;
    if ((i & 0xffff) === 0xffff) {
      parts.push(buffer);
      buffer = '';
      options.onProgress?.(i + 1, total);
    }
  }
  parts.push(buffer);
  options.onProgress?.(total, total);

  const name = `synthetic-profile-${options.mode}-${options.seed}.txt`;
  return new File(parts, name, { type: 'text/plain' });
}
