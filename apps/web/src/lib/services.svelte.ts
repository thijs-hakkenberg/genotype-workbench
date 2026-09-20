/**
 * Wires the contexts together and exposes reactive app state.
 * Contexts talk through their public APIs only (Core architecture, context map).
 */
import { OpfsDuckDbStorage, isStorageBusyError, requestPersistence, type StorageEstimate } from '@gw/storage';
import { PluginHost, type GrantRequest, type PromptAnswer } from '@gw/plugin-host';
import { AnnotationLibrary, type InstalledPack } from '@gw/annotation-library';
import { GenotypeStore, type Kit } from '@gw/genotype-store';
import type { Grant, PackIndex, PluginManifest } from '@gw/plugin-sdk';
import profileManifest from '@gw/profile-23andme/manifest.json';
import ancestryDnaManifest from '@gw/profile-ancestrydna/manifest.json';
import myHeritageManifest from '@gw/profile-myheritage/manifest.json';
import familyTreeDnaManifest from '@gw/profile-familytreedna/manifest.json';
import { manifest as viewManifest } from '@gw/view-tracks';
import haplogroupsManifest from '@gw/analysis-haplogroups/manifest.json';
import kinshipManifest from '@gw/analysis-kinship/manifest.json';
import structureManifest from '@gw/view-structure/manifest.json';
import paintingManifest from '@gw/view-painting/manifest.json';
import publicKey from '../../../../keys/pack-index.pub?raw';

/** The Pack Index signing key. Tests build with the fixture key instead. */
const PACK_INDEX_KEY: string = import.meta.env.VITE_PACK_INDEX_PUBKEY || publicKey;

export interface Services {
  storage: OpfsDuckDbStorage;
  host: PluginHost;
  library: AnnotationLibrary;
  store: GenotypeStore;
}

export const app = $state({
  phase: 'booting' as 'booting' | 'ready' | 'failed',
  bootStep: 'Starting the query engine',
  error: '',
  /** `busy`: another tab holds the stored files; `unsupported`: no OPFS here. */
  errorKind: 'other' as 'other' | 'busy' | 'unsupported',
  kits: [] as Kit[],
  activeKitId: null as string | null,
  /** The second kit, when two are being compared (v0.3, kinship). */
  compareKitId: null as string | null,
  installed: [] as InstalledPack[],
  index: null as PackIndex | null,
  indexError: '',
  grants: [] as Grant[],
  networkHosts: [] as string[],
  plugins: [] as PluginManifest[],
  locusVersion: '',
  estimate: null as StorageEstimate | null,
  grantRequest: null as (GrantRequest & { answer(a: PromptAnswer): void }) | null,
});

let services: Services | null = null;

export function svc(): Services {
  if (!services) throw new Error('services not ready');
  return services;
}

const ACTIVE_KIT = 'gw.activeKit';
const COMPARE_KIT = 'gw.compareKit';

function remember(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage may be blocked; this is only a convenience */
  }
}

function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function activeKit(): Kit | null {
  return app.kits.find((k) => k.kitId === app.activeKitId) ?? null;
}

export function setActiveKit(id: string | null) {
  app.activeKitId = id;
  remember(ACTIVE_KIT, id);
  // Nobody is ever compared with themselves.
  if (app.compareKitId === id) setCompareKit(null);
}

/** The kit the active one is being compared against, if any. */
export function compareKit(): Kit | null {
  return app.kits.find((k) => k.kitId === app.compareKitId) ?? null;
}

export function setCompareKit(id: string | null) {
  app.compareKitId = id === app.activeKitId ? null : id;
  remember(COMPARE_KIT, app.compareKitId);
}

/** The kits an analysis may read: every kit whose custody records a basis. */
export function analysableKits(): Kit[] {
  return app.kits.filter((k) => k.custody.consentBasis !== 'none');
}

/**
 * Why an analysis may not read this kit, in the words the UI shows.
 *
 * The host refuses these kits too (`ensureKits`); this is only so a page can
 * say so before asking, rather than opening a dialog that cannot be answered.
 */
export function consentBlock(kit: Kit): string | null {
  return kit.custody.consentBasis === 'none'
    ? `No consent is recorded for ${kit.custody.dataSubject}'s kit, so no analysis may read it.`
    : null;
}

function syncKits() {
  const s = svc();
  app.kits = s.store.list();
  if (!app.kits.some((k) => k.kitId === app.activeKitId)) setActiveKit(app.kits[0]?.kitId ?? null);
  if (app.compareKitId && !app.kits.some((k) => k.kitId === app.compareKitId)) setCompareKit(null);
}

function syncPacks() {
  app.installed = svc().library.list();
}

function syncHost() {
  const h = svc().host;
  app.grants = h.grants();
  app.networkHosts = h.networkHosts();
  app.plugins = h.manifests();
}

export async function refreshEstimate() {
  if (services) app.estimate = await services.storage.estimate();
}

/**
 * Whether this site can store `bytes` more. Browsers give each site a quota;
 * the estimate is what is left of it, which may be less than the free disk.
 */
export async function spaceFor(bytes: number): Promise<{ ok: boolean; available: number; needed: number }> {
  const needed = Math.round(bytes * 1.15) + 20_000_000; // headroom for DuckDB temp data
  try {
    const e = await navigator.storage.estimate();
    const available = Math.max(0, (e.quota ?? Infinity) - (e.usage ?? 0));
    return { ok: available >= needed, available, needed };
  } catch {
    return { ok: true, available: Infinity, needed };
  }
}

export async function refreshIndex() {
  try {
    app.index = await svc().library.fetchIndex();
    app.indexError = '';
  } catch (e) {
    app.indexError = e instanceof Error ? e.message : String(e);
  }
}

export async function boot() {
  try {
    app.errorKind = 'other';
    if (!('storage' in navigator) || !navigator.storage.getDirectory) {
      app.errorKind = 'unsupported';
      throw new Error('This browser has no Origin Private File System, so nothing could be kept on this device.');
    }
    const storage = await OpfsDuckDbStorage.open(new URL('/duckdb-extensions', location.href).href);
    const host = new PluginHost(storage);
    const library = new AnnotationLibrary(storage, host, new URL('/packs/', location.href), PACK_INDEX_KEY);
    const store = new GenotypeStore(storage);
    services = { storage, host, library, store };
    if (import.meta.env.DEV) (window as unknown as { __gw: Services }).__gw = services;

    app.bootStep = 'Opening your kits and packs';
    await host.init();
    for (const m of [profileManifest, ancestryDnaManifest, myHeritageManifest, familyTreeDnaManifest]) {
      host.register(m as PluginManifest);
    }
    host.register(viewManifest);
    host.register(haplogroupsManifest as PluginManifest);
    host.register(kinshipManifest as PluginManifest);
    host.register(structureManifest as PluginManifest);
    host.register(paintingManifest as PluginManifest);
    await library.init();
    await store.init();
    host.setPrompter(
      (req) =>
        new Promise<PromptAnswer>((resolve) => {
          app.grantRequest = { ...req, answer: (a) => ((app.grantRequest = null), resolve(a)) };
        }),
    );
    host.onChange(syncHost);
    library.onChange(syncPacks);
    store.on(syncKits);
    app.activeKitId = recall(ACTIVE_KIT);
    app.compareKitId = recall(COMPARE_KIT);
    syncKits();
    syncPacks();
    syncHost();

    app.bootStep = 'Checking the reference pack';
    await refreshIndex();
    if (app.index) {
      try {
        await library.installCore();
      } catch (e) {
        app.indexError = `Reference pack not installed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    app.locusVersion = await store.locusVersion();
    void requestPersistence().then(refreshEstimate);
    app.phase = 'ready';
  } catch (e) {
    console.error(e);
    if (isStorageBusyError(e)) app.errorKind = 'busy';
    app.error = e instanceof Error ? e.message : String(e);
    app.phase = 'failed';
  }
}
