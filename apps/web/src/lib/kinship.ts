/**
 * Runs the kinship plugin for two kits, through the host's services.
 *
 * Consent is checked twice over: `consentBlock` so a page can say why it will
 * not ask, and `ensureKits` so the host refuses regardless of what the page
 * does. A kit with no consent basis is never read (ADR-0009, ADR-0015).
 */
import { kinship, manifest as kinshipManifest, type KinshipResult } from '@gw/analysis-kinship';
import { viewName, type Kit } from '@gw/genotype-store';
import { KitsNotGranted } from '@gw/plugin-host';
import type { PackManifest } from '@gw/plugin-sdk';
import { consentBlock, svc } from './services.svelte';

export interface KinshipRun {
  result: KinshipResult | null;
  /** The genetic map the lengths are measured against, if one is installed. */
  map: PackManifest | null;
  /** Why nothing was computed, in the words the page shows. */
  blocked: string | null;
}

const cache = new Map<string, Promise<KinshipRun>>();

const subject = (kit: Kit) => ({
  kitId: kit.kitId,
  label: kit.label,
  dataSubject: kit.custody.dataSubject,
  consentBasis: kit.custody.consentBasis,
});

export function kinshipFor(a: Kit, b: Kit): Promise<KinshipRun> {
  const { library } = svc();
  const map = library.byRole('genetic-map').map((m) => `${m.id}@${m.version}`).join(',');
  // Order-independent: comparing A with B is comparing B with A.
  const key = `${[a.kitId, b.kitId].sort().join('|')}|${map}`;
  let p = cache.get(key);
  if (!p) {
    p = run(a, b);
    cache.set(key, p);
  }
  return p;
}

/** Forget a result, so a denied grant can be asked for again. */
export function forgetKinship(a: Kit, b: Kit) {
  for (const k of [...cache.keys()]) {
    if (k.startsWith([a.kitId, b.kitId].sort().join('|'))) cache.delete(k);
  }
}

async function run(a: Kit, b: Kit): Promise<KinshipRun> {
  const blocked = consentBlock(a) ?? consentBlock(b);
  if (blocked) return { result: null, map: null, blocked };

  const { library, host } = svc();
  try {
    await host.ensureKits(
      kinshipManifest.id,
      [subject(a), subject(b)],
      'Find the stretches of DNA these two kits share, by comparing every position both of them called.'
        + ' The comparison runs on this device and nothing is sent anywhere.',
    );
  } catch (e) {
    if (e instanceof KitsNotGranted) return { result: null, map: null, blocked: e.message };
    throw e;
  }

  const loci = await library.sharedLoci(viewName(a.kitId), viewName(b.kitId));
  if (loci.length === 0) {
    return {
      result: null,
      map: null,
      blocked: 'These two kits have no autosomal position in common, so there is nothing to compare.'
        + ' That usually means different chips with little overlap.',
    };
  }
  return { result: kinship(loci), map: library.byRole('genetic-map')[0] ?? null, blocked: null };
}
