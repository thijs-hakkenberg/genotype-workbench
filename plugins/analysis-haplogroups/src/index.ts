/**
 * Haplogroups from chip data (an `analysis` plugin, ADR-0010 family).
 *
 * A haplogroup traces one line only (mother's mother's… or father's
 * father's…). It is a best match against a published tree, limited by which
 * positions the chip reads, so the result is an estimate with its support
 * shown, never a statement about ancestry as a whole.
 */

/** One node of PhyloTree, as the haplotree-mt pack stores it. */
export interface MtNode {
  name: string;
  parent: string | null;
  depth: number;
  polys: string[];
  weights: number[];
}

/** One node of YTree with its chip-probed SNPs, as the haplotree-y pack stores it. */
export interface YNode {
  name: string;
  parent: string | null;
  depth: number;
  snp_names: string[];
  pos: number[];
  anc: string[];
  der: string[];
}

/** A haploid call (MT, or Y in a male sample). `allele` null is a no-call. */
export interface HaploidCall {
  pos: number;
  allele: string | null;
  /** GRCh37 (rCRS on MT) reference base, when known. */
  ref: string | null;
}

export type MarkerState = 'derived' | 'ancestral' | 'unread';

export interface PathStep {
  name: string;
  markers: { label: string; state: MarkerState }[];
}

export interface HaplogroupResult {
  lineage: 'mt' | 'y';
  /** Best-supported haplogroup, or null when the calls cannot place one. */
  best: string | null;
  /** Root-to-best path with each defining marker's state in the kit. */
  path: PathStep[];
  /** Nearby candidates with their scores, best first. */
  candidates: { name: string; score: number }[];
  /** Tree positions the chip read (not no-calls). */
  positionsRead: number;
  /** Of those, how many place the kit on a branch. */
  informative: number;
  note: string | null;
}

const MT_POLY = /^\(?(\d+)([ACGT])(!*)\)?$/;

interface ParsedPoly {
  pos: number;
  base: string;
  label: string;
  weight: number;
}

function parsePolys(n: MtNode): ParsedPoly[] {
  const out: ParsedPoly[] = [];
  n.polys.forEach((p, i) => {
    const m = p.match(MT_POLY);
    if (m) out.push({ pos: Number(m[1]), base: m[2]!, label: p, weight: n.weights[i] ?? 1 });
  });
  return out;
}

function childrenOf<T extends { name: string; parent: string | null }>(nodes: T[]): Map<string | null, T[]> {
  const kids = new Map<string | null, T[]>();
  for (const n of nodes) (kids.get(n.parent) ?? kids.set(n.parent, []).get(n.parent)!).push(n);
  return kids;
}

function lowestCommonAncestor(paths: string[][]): string | null {
  if (paths.length === 0) return null;
  let common = paths[0]!;
  for (const p of paths.slice(1)) {
    let i = 0;
    while (i < common.length && i < p.length && common[i] === p[i]) i++;
    common = common.slice(0, i);
  }
  return common.at(-1) ?? null;
}

/**
 * mtDNA: HaploGrep-style weighted Kulczynski score between the mutations a
 * node expects (relative to rCRS) and the differences the kit shows, both
 * restricted to positions the chip read. Ties go to their common ancestor,
 * because the chip cannot tell those branches apart.
 */
export function mtHaplogroup(tree: MtNode[], calls: HaploidCall[]): HaplogroupResult {
  const read = new Map<number, HaploidCall>();
  for (const c of calls) if (c.allele && /^[ACGT]$/.test(c.allele)) read.set(c.pos, c);
  if (read.size === 0) {
    return { lineage: 'mt', best: null, path: [], candidates: [], positionsRead: 0, informative: 0, note: 'The file has no readable mitochondrial calls.' };
  }
  const kids = childrenOf(tree);
  type Scored = { node: MtNode; score: number; path: string[]; steps: PathStep[] };
  const scored: Scored[] = [];
  // First pass: every position the tree uses, with its phylogenetic weight.
  const weightAt = new Map<number, number>();
  for (const n of tree) for (const p of parsePolys(n)) weightAt.set(p.pos, Math.max(weightAt.get(p.pos) ?? 0, p.weight));
  const treePositions = new Set(weightAt.keys());

  // The kit's differences from rCRS at tree positions the chip read: constant across nodes.
  let wSample = 0;
  for (const [pos, c] of read) if (c.ref && c.allele !== c.ref && treePositions.has(pos)) wSample += weightAt.get(pos) ?? 1;

  const walk = (parent: string | null, state: Map<number, string>, path: string[], steps: PathStep[]) => {
    for (const node of kids.get(parent) ?? []) {
      const next = new Map(state);
      const polys = parsePolys(node);
      const markers: PathStep['markers'] = [];
      for (const p of polys) {
        next.set(p.pos, p.base);
        const c = read.get(p.pos);
        markers.push({ label: p.label, state: !c ? 'unread' : c.allele === p.base ? 'derived' : 'ancestral' });
      }
      const nodePath = [...path, node.name];
      const nodeSteps = [...steps, { name: node.name, markers }];
      // Expected differences from rCRS, among positions the chip read.
      let wExpected = 0;
      let wFound = 0;
      for (const [pos, base] of next) {
        const c = read.get(pos);
        if (!c || !c.ref || base === c.ref) continue;
        const w = weightAt.get(pos) ?? 1;
        wExpected += w;
        if (c.allele === base) wFound += w;
      }
      const a = wExpected === 0 ? (wSample === 0 ? 1 : 0) : wFound / wExpected;
      const b = wSample === 0 ? (wExpected === 0 ? 1 : 0) : wFound / wSample;
      scored.push({ node, score: 0.5 * (a + b), path: nodePath, steps: nodeSteps });
      walk(node.name, next, nodePath, nodeSteps);
    }
  };
  walk(null, new Map(), [], []);

  scored.sort((x, y) => y.score - x.score || x.node.depth - y.node.depth);
  const top = scored[0];
  if (!top) return { lineage: 'mt', best: null, path: [], candidates: [], positionsRead: read.size, informative: 0, note: 'The tree pack is empty.' };
  const tied = scored.filter((s) => Math.abs(s.score - top.score) < 1e-9);
  const best = tied.length > 1 ? lowestCommonAncestor(tied.map((t) => t.path)) : top.node.name;
  const bestScored = scored.find((s) => s.node.name === best) ?? top;
  const informative = [...read.keys()].filter((p) => treePositions.has(p)).length;
  return {
    lineage: 'mt',
    best,
    path: bestScored.steps,
    candidates: scored.slice(0, 6).map((s) => ({ name: s.node.name, score: s.score })),
    positionsRead: read.size,
    informative,
    note: tied.length > 1 ? `${tied.length} branches fit equally well; shown is the branch they share.` : null,
  };
}

/**
 * Y: walk the tree accumulating support (derived calls) and conflicts
 * (ancestral calls, weighted double); the best haplogroup is the deepest node
 * with its own derived support on the best-scoring path.
 */
export function yHaplogroup(tree: YNode[], calls: HaploidCall[]): HaplogroupResult {
  const read = new Map<number, string>();
  for (const c of calls) if (c.allele && /^[ACGT]$/.test(c.allele)) read.set(c.pos, c.allele);
  if (read.size === 0) {
    return {
      lineage: 'y', best: null, path: [], candidates: [], positionsRead: 0, informative: 0,
      note: 'The file has no Y calls, as expected without a Y chromosome. A paternal line can then be traced only through a male relative’s kit.',
    };
  }
  const kids = childrenOf(tree);
  type Scored = { node: YNode; cum: number; derived: number; steps: PathStep[] };
  let best: Scored | null = null;
  const candidates: Scored[] = [];
  let informative = 0;
  const walk = (parent: string | null, cum: number, steps: PathStep[]) => {
    for (const node of kids.get(parent) ?? []) {
      let d = 0;
      let a = 0;
      const markers: PathStep['markers'] = node.pos.map((pos, i) => {
        const allele = read.get(pos);
        if (!allele) return { label: node.snp_names[i] ?? String(pos), state: 'unread' as const };
        informative++;
        if (allele === node.der[i]) d++;
        else if (allele === node.anc[i]) a++;
        return { label: node.snp_names[i] ?? String(pos), state: allele === node.der[i] ? ('derived' as const) : ('ancestral' as const) };
      });
      const score = cum + d - 2 * a;
      const nodeSteps = [...steps, { name: node.name, markers }];
      const s: Scored = { node, cum: score, derived: d, steps: nodeSteps };
      if (d > 0) {
        candidates.push(s);
        if (!best || score > best.cum || (score === best.cum && node.depth > best.node.depth)) best = s;
      }
      // Descend only while the line is not contradicted.
      if (score > -2) walk(node.name, score, nodeSteps);
    }
  };
  walk(null, 0, []);
  candidates.sort((x, y) => y.cum - x.cum || y.node.depth - x.node.depth);
  const b = best as Scored | null;
  return {
    lineage: 'y',
    best: b?.node.name ?? null,
    path: b ? b.steps.filter((s) => s.markers.some((m) => m.state !== 'unread') || s.name === b.node.name) : [],
    candidates: candidates.slice(0, 6).map((c) => ({ name: c.node.name, score: c.cum })),
    positionsRead: read.size,
    informative,
    note: b ? null : 'None of the Y positions the chip read places the kit on the tree.',
  };
}
