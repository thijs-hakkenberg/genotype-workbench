/**
 * Relating an allele a source reports to a plus-strand call.
 *
 * Studies do not always report alleles on the GRCh37 plus strand (older
 * papers and gene-centric reports often use the gene's coding strand). When
 * the reported allele fits only as a complement of the alleles seen at the
 * site, it is read on the other strand, and the result says so. A/T and C/G
 * sites are reported as ambiguous: there the strand cannot be inferred.
 */

const COMPLEMENT: Record<string, string> = { A: 'T', T: 'A', C: 'G', G: 'C' };

export type AlleleBasis = 'plus' | 'complement' | 'ambiguous' | 'unplaced';

export interface AlleleRelation {
  /** The reported allele read on the plus strand (when placeable). */
  plus: string;
  basis: AlleleBasis;
  /** How many copies of `plus` the call carries: 0, 1 or 2 (null for a no-call). */
  copies: number | null;
}

export function relateAllele(
  reported: string,
  call: { a1: string | null; a2: string | null; is_nocall: boolean } | null,
  siteAlleles: (string | null | undefined)[],
): AlleleRelation {
  const r = reported.toUpperCase();
  const calls = call && !call.is_nocall ? [call.a1, call.a2].filter((a): a is string => !!a && a in COMPLEMENT) : [];
  const seen = new Set([...siteAlleles, ...calls].filter((a): a is string => !!a && a in COMPLEMENT));
  const count = (a: string) => (call && !call.is_nocall ? calls.filter((c) => c === a).length : null);
  if (!(r in COMPLEMENT)) return { plus: r, basis: 'unplaced', copies: null };

  const all = new Set([...seen, r]);
  const palindromic = all.size === 2 && [...all].every((a) => all.has(COMPLEMENT[a]!));
  if (palindromic) return { plus: r, basis: 'ambiguous', copies: count(r) };
  if (seen.has(r)) return { plus: r, basis: 'plus', copies: count(r) };
  const comp = COMPLEMENT[r]!;
  if (seen.has(comp)) return { plus: comp, basis: 'complement', copies: count(comp) };
  return { plus: r, basis: 'unplaced', copies: count(r) };
}
