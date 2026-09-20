/**
 * Structure files: fetched once per protein under a grant, then kept here.
 *
 * Asking AlphaFold for a structure tells it which protein you are looking at,
 * so it goes through the Plugin Host like any other network access. After the
 * first view the file is read from this device.
 */
import { manifest as structureManifest } from '@gw/view-structure';
import { svc } from './services.svelte';

export const ALPHAFOLD_HOST = 'alphafold.ebi.ac.uk';
const MODEL_VERSION = 'v6';

export function structurePath(accession: string): string {
  return `structures/AF-${accession}-F1-model_${MODEL_VERSION}.bcif`;
}

export async function isStructureOnDevice(accession: string): Promise<boolean> {
  return svc().storage.hasFile(structurePath(accession));
}

/** Bytes of a protein's predicted structure, from this device or from AlphaFold. */
export async function structureBytes(accession: string, proteinName: string): Promise<Uint8Array<ArrayBuffer>> {
  const { storage, host } = svc();
  const path = structurePath(accession);
  const cached = await storage.readFile(path);
  if (cached) return cached as Uint8Array<ArrayBuffer>;
  await host.ensureNetwork(
    structureManifest.id,
    ALPHAFOLD_HOST,
    `Download the predicted structure of ${proteinName} (${accession}) from AlphaFold. This tells AlphaFold which protein you are looking at; it is not told anything about your genotype.`,
  );
  const url = `https://${ALPHAFOLD_HOST}/files/AF-${accession}-F1-model_${MODEL_VERSION}.bcif`;
  const res = await host.fetch(structureManifest.id, url);
  if (!res.ok) throw new Error(`AlphaFold has no model for ${accession} (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>;
  await storage.putFile(path, bytes);
  return bytes;
}
