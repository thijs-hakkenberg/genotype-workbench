/**
 * Runs the haplogroups analysis plugin for one kit, through the host's
 * services: the kit's MT and Y calls and the installed tree packs. Consent is
 * checked first (ADR-0009): a kit with no consent basis is never analysed.
 */
import { mtHaplogroup, yHaplogroup, type HaplogroupResult, type MtNode, type YNode } from '@gw/analysis-haplogroups';
import type { PackManifest } from '@gw/plugin-sdk';
import type { Kit } from '@gw/genotype-store';
import { consentBlock, svc } from './services.svelte';

export interface LineageResult {
  result: HaplogroupResult;
  pack: PackManifest;
}

export interface Lineages {
  mt: LineageResult | null;
  y: LineageResult | null;
  blocked: string | null;
}

const cache = new Map<string, Promise<Lineages>>();

export function lineagesFor(kit: Kit): Promise<Lineages> {
  const { library } = svc();
  const versions = [...library.byRole('haplotree-mt'), ...library.byRole('haplotree-y')].map((m) => `${m.id}@${m.version}`).join(',');
  const key = `${kit.kitId}|${versions}`;
  let p = cache.get(key);
  if (!p) {
    p = run(kit);
    cache.set(key, p);
  }
  return p;
}

async function run(kit: Kit): Promise<Lineages> {
  const blocked = consentBlock(kit);
  if (blocked) return { mt: null, y: null, blocked };
  const { store, library } = svc();
  const [mtTree, yTree] = await Promise.all([library.allRows<MtNode>('haplotree-mt'), library.allRows<YNode>('haplotree-y')]);
  const haploid = async (chrom: 'MT' | 'Y') => {
    const rows = await store.callsIn(kit.kitId, { chrom, start: 1, end: chrom === 'MT' ? 16_569 : 59_373_566 });
    return rows.map((r) => ({ pos: r.pos, allele: r.is_nocall ? null : r.a2 && r.a2 !== r.a1 ? null : r.a1, ref: r.ref }));
  };
  const [mtCalls, yCalls] = await Promise.all([mtTree ? haploid('MT') : [], yTree ? haploid('Y') : []]);
  return {
    mt: mtTree ? { result: mtHaplogroup(mtTree.rows, mtCalls), pack: mtTree.pack } : null,
    y: yTree ? { result: yHaplogroup(yTree.rows, yCalls), pack: yTree.pack } : null,
    blocked: null,
  };
}
