/**
 * Annotation Library (supporting context).
 *
 * Reference knowledge arrives only as whole packs listed in a signed index,
 * downloaded in full and joined on this device (ADR-0007). Querying a remote
 * service per variant would reveal which variants a person carries; a whole
 * pack reveals nothing.
 */
import { BIN_ABOVE_BP, BINS_PER_WINDOW, type Chrom, type PackIndex, type PackManifest, type PluginManifest, type Region, type TrackItem, type TrackSource } from '@gw/plugin-sdk';
import type { PluginHost } from '@gw/plugin-host';
import { ident, type StorageAdapter } from '@gw/storage';
import type { ClinvarRow, GeneRow, GnomadRow, GwasRow } from './rows';
import { classificationShort } from './rows';
import { sha256Hex, verifyIndexSignature } from './verify';

export * from './rows';
export { sha256Hex, verifyIndexSignature } from './verify';
export * from './alleles';

const PACKS_JSON = 'meta/packs.json';

/** The first-party connector that downloads packs from the Pack Index host. */
export const PACK_INDEX_PLUGIN: PluginManifest = {
  id: 'pack-index',
  version: '0.1.0',
  hostApi: '^0.1',
  capabilities: ['annotation-pack'],
  title: 'Pack Index',
  description: 'Downloads whole annotation packs from the signed Pack Index and verifies them before install.',
  firstParty: true,
  permissions: { network: ['self'] },
};

export interface InstalledPack {
  manifest: PackManifest;
  installedAt: string;
  file: string;
}

export interface CallOverlap {
  classification: string;
  n: number;
}

export interface Annotations {
  clinvar: ClinvarRow[];
  gwas: GwasRow[];
  gnomad: GnomadRow[];
  genes: GeneRow[];
}

export class PackIntegrityError extends Error {}

export class AnnotationLibrary {
  private installed: InstalledPack[] = [];
  private listeners = new Set<() => void>();
  private index: PackIndex | null = null;

  constructor(
    private storage: StorageAdapter,
    private host: PluginHost,
    /** Base URL of the Pack Index; same origin in iteration 1. */
    private indexBase: URL,
    private publicKeyB64: string,
  ) {}

  async init(): Promise<void> {
    this.host.register(PACK_INDEX_PLUGIN);
    this.installed = (await this.storage.readJson<InstalledPack[]>(PACKS_JSON)) ?? [];
    for (const p of this.installed) await this.storage.attachParquet(p.file, packView(p.manifest.id));
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }

  list(): InstalledPack[] {
    return [...this.installed];
  }

  get(id: string): InstalledPack | undefined {
    return this.installed.find((p) => p.manifest.id === id);
  }

  has(id: string): boolean {
    return this.installed.some((p) => p.manifest.id === id);
  }

  get indexHost(): string {
    return this.indexBase.host;
  }

  /**
   * Fetch and verify the signed index. The index lists packs; reading it
   * reveals nothing about the person, and it is served by the app's own origin.
   */
  async fetchIndex(): Promise<PackIndex> {
    const [idx, sig] = await Promise.all([
      fetch(new URL('index.json', this.indexBase), { cache: 'no-cache' }),
      fetch(new URL('index.json.sig', this.indexBase), { cache: 'no-cache' }),
    ]);
    if (!idx.ok || !sig.ok) throw new Error(`Pack Index unavailable at ${this.indexBase.href} (${idx.status})`);
    const bytes = new Uint8Array(await idx.arrayBuffer());
    if (!(await verifyIndexSignature(bytes, await sig.text(), this.publicKeyB64))) {
      throw new PackIntegrityError('The Pack Index signature does not verify. Nothing from it will be installed.');
    }
    this.index = JSON.parse(new TextDecoder().decode(bytes)) as PackIndex;
    return this.index;
  }

  /** Core reference packs install without a prompt: they are part of the app, from its own origin. */
  async installCore(): Promise<void> {
    const index = this.index ?? (await this.fetchIndex());
    for (const m of index.packs.filter((p) => p.core)) {
      const current = this.get(m.id);
      if (current?.manifest.sha256 === m.sha256) continue;
      const res = await fetch(new URL(m.path, this.indexBase));
      await this.store(m, res);
    }
  }

  /** Download a whole pack after the user grants the index host, verify it, store it. */
  async install(manifest: PackManifest, onProgress?: (done: number, total: number) => void): Promise<void> {
    const host = this.indexHost;
    await this.host.ensureNetwork(
      PACK_INDEX_PLUGIN.id,
      host,
      `Download the whole ${manifest.title} pack (${manifest.id} ${manifest.version}).`,
      manifest.size,
    );
    const res = await this.host.fetch(PACK_INDEX_PLUGIN.id, new URL(manifest.path, this.indexBase));
    await this.store(manifest, res, onProgress);
  }

  private async store(manifest: PackManifest, res: Response, onProgress?: (done: number, total: number) => void) {
    if (!res.ok || !res.body) throw new Error(`Download of ${manifest.id} failed (${res.status})`);
    const chunks: Uint8Array[] = [];
    let done = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      chunks.push(value);
      done += value.length;
      onProgress?.(done, manifest.size);
    }
    const bytes = new Uint8Array(done);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    const digest = await sha256Hex(bytes);
    if (digest !== manifest.sha256) {
      throw new PackIntegrityError(`${manifest.id}: SHA-256 does not match the signed index. The download was discarded.`);
    }
    const previous = this.get(manifest.id);
    if (previous) await this.remove(manifest.id, false);
    const file = `packs/${manifest.id}-${manifest.version}.parquet`;
    await this.storage.putFile(file, bytes);
    await this.storage.attachParquet(file, packView(manifest.id));
    this.installed.push({ manifest, installedAt: new Date().toISOString(), file });
    await this.storage.writeJson(PACKS_JSON, this.installed);
    this.changed();
  }

  async remove(id: string, notify = true): Promise<void> {
    const p = this.get(id);
    if (!p) return;
    await this.storage.detach(packView(id));
    await this.storage.deleteFile(p.file);
    this.installed = this.installed.filter((x) => x.manifest.id !== id);
    await this.storage.writeJson(PACKS_JSON, this.installed);
    if (notify) this.changed();
  }

  /** The reference-grch37 columns the normalizer needs, as typed arrays. */
  async referenceColumns(): Promise<{ columns: { chrom: Uint8Array; pos: Uint32Array; base: Uint8Array }; pack: string } | null> {
    const ref = this.get('reference-grch37');
    if (!ref) return null;
    const t = await this.storage.queryArrow(
      `SELECT CAST(chrom AS UTINYINT) AS chrom, CAST(pos AS UINTEGER) AS pos, CAST(ascii(ref) AS UTINYINT) AS base
       FROM ${ident(packView('reference-grch37'))}`,
    );
    const col = <T>(name: string) => t.getChild(name)!.toArray() as T;
    return {
      columns: { chrom: col<Uint8Array>('chrom'), pos: col<Uint32Array>('pos'), base: col<Uint8Array>('base') },
      pack: `reference-grch37@${ref.manifest.version}`,
    };
  }

  /** Everything installed packs say about one position. */
  async annotationsAt(chrom: Chrom, pos: number): Promise<Annotations> {
    const at = <T>(id: string, cols: string) =>
      this.has(id)
        ? this.storage.query<T & Record<string, unknown>>(
            `SELECT ${cols} FROM ${ident(packView(id))} WHERE chrom = ? AND pos = ?`, [chrom, pos])
        : Promise.resolve([] as T[]);
    const [clinvar, gwas, gnomad, genes] = await Promise.all([
      at<ClinvarRow>('clinvar', '*'),
      at<GwasRow>('gwas-catalog', '*'),
      at<GnomadRow>('gnomad-chip', '*'),
      this.has('genes-ensembl75')
        ? this.storage.query<GeneRow & Record<string, unknown>>(
            `SELECT * FROM ${ident(packView('genes-ensembl75'))} WHERE chrom = ? AND start <= ? AND "end" >= ?`,
            [chrom, pos, pos])
        : Promise.resolve([]),
    ]);
    return {
      clinvar: clinvar as ClinvarRow[],
      gwas: (gwas as GwasRow[]).sort((a, b) => (b.p_mlog ?? 0) - (a.p_mlog ?? 0)),
      gnomad: gnomad as GnomadRow[],
      genes: genes as GeneRow[],
    };
  }

  /** Gene symbol lookup for the search box. */
  async findGene(symbol: string): Promise<GeneRow | null> {
    if (!this.has('genes-ensembl75')) return null;
    const rows = await this.storage.query<GeneRow & Record<string, unknown>>(
      `SELECT * FROM ${ident(packView('genes-ensembl75'))} WHERE upper(symbol) = upper(?)
       ORDER BY biotype = 'protein_coding' DESC LIMIT 1`, [symbol.trim()]);
    return (rows[0] as GeneRow) ?? null;
  }

  /** rsID lookup in packs, for rsIDs the kit does not carry. */
  async findRsid(rsid: string): Promise<{ chrom: Chrom; pos: number } | null> {
    for (const id of ['clinvar', 'gwas-catalog']) {
      if (!this.has(id)) continue;
      const rows = await this.storage.query<{ chrom: Chrom; pos: number }>(
        `SELECT chrom, pos FROM ${ident(packView(id))} WHERE rsid = ? LIMIT 1`, [rsid.trim().toLowerCase()]);
      if (rows[0]) return rows[0];
    }
    return null;
  }

  /**
   * Where the kit's calls carry an allele that ClinVar classifies: counts per
   * classification. States what the source says; computes no score.
   */
  async clinvarOverlap(kitView: string): Promise<CallOverlap[]> {
    if (!this.has('clinvar')) return [];
    return this.storage.query<CallOverlap & Record<string, unknown>>(
      `SELECT c.classification, CAST(count(*) AS INTEGER) AS n
       FROM ${ident(packView('clinvar'))} c JOIN ${ident(kitView)} k
         ON k.chrom = c.chrom AND k.pos = c.pos AND NOT k.is_nocall AND (k.a1 = c.alt OR k.a2 = c.alt)
       GROUP BY 1 ORDER BY 2 DESC`) as Promise<CallOverlap[]>;
  }

  async clinvarForKit(
    kitView: string,
    classification: string | null,
    limit = 500,
  ): Promise<(ClinvarRow & { a1: string; a2: string | null; strand_ambiguous: boolean })[]> {
    if (!this.has('clinvar')) return [];
    const where = classification ? 'AND c.classification = ?' : '';
    return this.storage.query(
      `SELECT c.*, k.a1, k.a2, k.strand_ambiguous
       FROM ${ident(packView('clinvar'))} c JOIN ${ident(kitView)} k
         ON k.chrom = c.chrom AND k.pos = c.pos AND NOT k.is_nocall AND (k.a1 = c.alt OR k.a2 = c.alt)
       WHERE true ${where}
       ORDER BY c.stars DESC, c.classification, c.chrom, c.pos LIMIT ${limit}`,
      classification ? [classification] : []) as never;
  }

  /** Annotation tracks, each encoded by its pack's evidence kind. */
  trackSources(): TrackSource[] {
    const out: TrackSource[] = [];
    const genes = this.get('genes-ensembl75');
    if (genes) out.push(this.geneTrack(genes.manifest));
    const clinvar = this.get('clinvar');
    if (clinvar) out.push(this.clinvarTrack(clinvar.manifest));
    const gwas = this.get('gwas-catalog');
    if (gwas) out.push(this.gwasTrack(gwas.manifest));
    const gnomad = this.get('gnomad-chip');
    if (gnomad) out.push(this.gnomadTrack(gnomad.manifest));
    return out;
  }

  private descriptor(m: PackManifest, title: string) {
    return {
      id: `pack:${m.id}`,
      kind: m.trackKind ?? 'variant',
      build: m.build,
      source: m.source.short ?? m.source.name,
      version: m.version,
      evidenceKind: m.evidenceKind,
      title,
      licence: m.licence,
    } as const;
  }

  /** Record counts per bin for wide windows; `weight` carries the bin's strongest value. */
  private async binned<T>(id: string, region: Region, strongest: string): Promise<TrackItem<T>[]> {
    const size = Math.max(1, Math.ceil((region.end - region.start + 1) / BINS_PER_WINDOW));
    const rows = await this.storage.query<{ b: number; n: number; w: number | null }>(
      `SELECT CAST(floor((pos - ?) / ${size}) AS INTEGER) AS b, CAST(count(*) AS INTEGER) AS n, CAST(${strongest} AS DOUBLE) AS w
       FROM ${ident(packView(id))} WHERE chrom = ? AND pos BETWEEN ? AND ? GROUP BY 1`,
      [region.start, region.chrom, region.start, region.end]);
    return rows.map((r) => ({
      id: `bin:${r.b}`,
      start: region.start + r.b * size,
      end: region.start + (r.b + 1) * size - 1,
      count: r.n,
      weight: r.w ?? undefined,
      label: `${r.n.toLocaleString('en-US')} records`,
      row: null as unknown as T,
    }));
  }

  private wide(region: Region) {
    return region.end - region.start > BIN_ABOVE_BP;
  }

  private inRegion<T>(id: string, region: Region, cols = '*', limit = 20_000) {
    return this.storage.query<T & Record<string, unknown>>(
      `SELECT ${cols} FROM ${ident(packView(id))} WHERE chrom = ? AND pos BETWEEN ? AND ? ORDER BY pos LIMIT ${limit}`,
      [region.chrom, region.start, region.end]) as Promise<T[]>;
  }

  private geneTrack(m: PackManifest): TrackSource<GeneRow> {
    return {
      descriptor: this.descriptor(m, 'Gene models'),
      itemsIn: async (region) => {
        const rows = (await this.storage.query<GeneRow & Record<string, unknown>>(
          `SELECT * FROM ${ident(packView(m.id))} WHERE chrom = ? AND start <= ? AND "end" >= ?
           ORDER BY (biotype = 'protein_coding') DESC, "end" - start DESC LIMIT 400`,
          [region.chrom, region.end, region.start])) as GeneRow[];
        return rows.map((r): TrackItem<GeneRow> => ({ id: r.gene_id, start: r.start, end: r.end, label: r.symbol, row: r }));
      },
    };
  }

  private clinvarTrack(m: PackManifest): TrackSource<ClinvarRow> {
    return {
      descriptor: this.descriptor(m, 'ClinVar'),
      itemsIn: async (region) =>
        this.wide(region) ? this.binned<ClinvarRow>(m.id, region, 'max(stars)') : (await this.inRegion<ClinvarRow>(m.id, region)).map((r) => ({
          id: `${r.chrom}:${r.pos}:${r.alt}:${r.variation_id}`,
          start: r.pos,
          end: r.pos,
          label: classificationShort(r.classification),
          weight: r.stars,
          row: r,
        })),
    };
  }

  private gwasTrack(m: PackManifest): TrackSource<GwasRow> {
    return {
      descriptor: this.descriptor(m, 'GWAS Catalog'),
      itemsIn: async (region) =>
        this.wide(region) ? this.binned<GwasRow>(m.id, region, 'max(p_mlog)') : (await this.inRegion<GwasRow>(m.id, region)).map((r, i) => ({
          id: `${r.chrom}:${r.pos}:${r.study_accession}:${i}`,
          start: r.pos,
          end: r.pos,
          label: r.trait,
          weight: r.p_mlog ?? 0,
          row: r,
        })),
    };
  }

  private gnomadTrack(m: PackManifest): TrackSource<GnomadRow> {
    return {
      descriptor: this.descriptor(m, 'gnomAD frequency'),
      itemsIn: async (region) =>
        this.wide(region) ? this.binned<GnomadRow>(m.id, region, 'avg(af)') : (await this.inRegion<GnomadRow>(m.id, region)).map((r) => ({
          id: `${r.chrom}:${r.pos}:${r.alt}`,
          start: r.pos,
          end: r.pos,
          label: `${r.alt} ${r.af.toFixed(3)}`,
          value: r.af,
          lo: r.af_lo,
          hi: r.af_hi,
          row: r,
        })),
    };
  }
}

export function packView(id: string): string {
  return `pack_${id.replaceAll('-', '_')}`;
}
