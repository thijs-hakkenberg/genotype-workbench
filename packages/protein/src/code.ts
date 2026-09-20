/** The genetic code. Mitochondrial genes use the vertebrate mitochondrial code. */

const BASES = ['T', 'C', 'A', 'G'] as const;
const STANDARD =
  'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
// Vertebrate mitochondrial: AGA/AGG are stops, ATA is Met, TGA is Trp.
const MITO = STANDARD.split('');
const codonIndex = (codon: string) => {
  const i = BASES.indexOf(codon[0] as 'T');
  const j = BASES.indexOf(codon[1] as 'T');
  const k = BASES.indexOf(codon[2] as 'T');
  return i < 0 || j < 0 || k < 0 ? -1 : i * 16 + j * 4 + k;
};
for (const [codon, aa] of [['AGA', '*'], ['AGG', '*'], ['ATA', 'M'], ['TGA', 'W']] as const) {
  MITO[codonIndex(codon)] = aa;
}

export type GeneticCode = 'standard' | 'vertebrate-mitochondrial';

export function translateCodon(codon: string, code: GeneticCode = 'standard'): string | null {
  const i = codonIndex(codon.toUpperCase());
  if (i < 0) return null;
  return (code === 'standard' ? STANDARD[i] : MITO[i]) ?? null;
}

const THREE: Record<string, string> = {
  A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile',
  L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val',
  '*': 'Ter',
};

export const aaThreeLetter = (aa: string): string => THREE[aa] ?? aa;

export const COMPLEMENT: Record<string, string> = { A: 'T', T: 'A', C: 'G', G: 'C', N: 'N' };

export function complement(base: string): string {
  return COMPLEMENT[base.toUpperCase()] ?? 'N';
}

export function reverseComplement(seq: string): string {
  return [...seq].reverse().map(complement).join('');
}
