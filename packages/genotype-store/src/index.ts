/**
 * Genotype Store (core context): turns a consumer raw-data file into a
 * trusted, normalized set of calls on GRCh37, held under explicit custody.
 */
import * as Comlink from 'comlink';
import { Table, Utf8, makeData, makeVector } from 'apache-arrow';
import { BIN_ABOVE_BP, BINS_PER_WINDOW, type Chrom, type Region, type TrackItem, type TrackSource } from '@gw/plugin-sdk';
import { ident, type StorageAdapter } from '@gw/storage';
import profile23andMe from '@gw/profile-23andme/profile.json';
import profileAncestryDna from '@gw/profile-ancestrydna/profile.json';
import profileMyHeritage from '@gw/profile-myheritage/profile.json';
import profileFamilyTreeDna from '@gw/profile-familytreedna/profile.json';
import type { ImportColumns, ImportWorkerApi, ReferenceColumns } from './import.worker';
import type { CallRow, ConsentBasis, Custody, DensityBin, ImportMeta, Kit, RefCheck } from './types';

export * from './types';
export type { ReferenceColumns } from './import.worker';

const KITS_JSON = 'meta/kits.json';
/**
 * Order matters for detection: MyHeritage and FamilyTreeDNA share a column
 * header, so MyHeritage's comment banner has to be looked for first.
 */
const PROFILES = [profile23andMe, profileAncestryDna, profileMyHeritage, profileFamilyTreeDna];
const REF_CHECK_ORDER: RefCheck[] = [
  'match', 'hom-non-ref', 'complement-only', 'mismatch', 'unknown', 'indel-unresolved', 'not-applicable',
];

export type GenotypeEvent =
  | { type: 'KitImported'; kit: Kit }
  | { type: 'KitDeleted'; kitId: string };

/** A file that has been read and normalized but not yet saved. */
export interface PreparedImport {
  sourceName: string;
  meta: ImportMeta;
  columns: ImportColumns;
  referencePack: string | null;
}

export class ImportRefused extends Error {}

export class GenotypeStore {
  private kits: Kit[] = [];
  private listeners = new Set<(e: GenotypeEvent) => void>();
  private worker: Comlink.Remote<ImportWorkerApi> | null = null;

  constructor(private storage: StorageAdapter) {}

  async init(): Promise<void> {
    this.kits = (await this.storage.readJson<Kit[]>(KITS_JSON)) ?? [];
    for (const kit of this.kits) await this.storage.attachParquet(kit.file, viewName(kit.kitId));
  }

  on(fn: (e: GenotypeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: GenotypeEvent) {
    for (const fn of this.listeners) fn(e);
  }

  list(): Kit[] {
    return [...this.kits];
  }

  get(kitId: string): Kit | undefined {
    return this.kits.find((k) => k.kitId === kitId);
  }

  private importer(): Comlink.Remote<ImportWorkerApi> {
    this.worker ??= Comlink.wrap<ImportWorkerApi>(
      new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' }),
    );
    return this.worker;
  }

  locusVersion(): Promise<string> {
    return this.importer().version();
  }

  /** Which vendor profile matches this file, from its first 64 KB. */
  async detect(file: File): Promise<string | null> {
    const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
    return this.importer().detect(head, JSON.stringify(PROFILES));
  }

  /**
   * Read and normalize a file in the import worker. Nothing is stored until
   * `save` is called with a custody record.
   */
  async prepare(
    file: File,
    reference: { columns: ReferenceColumns; pack: string } | null,
    onProgress?: (rows: number) => void,
  ): Promise<PreparedImport> {
    const profileId = await this.detect(file);
    const profile = PROFILES.find((p) => p.id === profileId);
    if (!profile) {
      throw new ImportRefused(
        `This file is not a format this version can read. It reads ${PROFILES.map((p) => p.vendorLabel).join(', ')}`
          + ' raw data exports, on build 37.',
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const empty: ReferenceColumns = { chrom: new Uint8Array(), pos: new Uint32Array(), base: new Uint8Array() };
    const columns = await this.importer()
      .importFile(Comlink.transfer(bytes, [bytes.buffer]), JSON.stringify(profile), reference?.columns ?? empty,
        onProgress ? Comlink.proxy(onProgress) : undefined)
      .catch((e: unknown) => {
        throw new ImportRefused(e instanceof Error ? e.message : String(e));
      });
    const meta = JSON.parse(columns.metaJson) as ImportMeta;
    if (this.kits.some((k) => k.sourceSha256 === meta.sourceSha256)) {
      throw new ImportRefused('This exact file has already been imported. Kits are immutable, so it is not imported twice.');
    }
    return { sourceName: file.name, meta, columns, referencePack: reference?.pack ?? null };
  }

  /** Store a prepared import under a custody record (every kit has exactly one). */
  async save(prepared: PreparedImport, label: string, custody: Custody): Promise<Kit> {
    const kitId = crypto.randomUUID();
    const file = `kits/${kitId}.parquet`;
    const staging = `staging_${kitId.replaceAll('-', '')}`;
    await this.storage.insertArrow(toArrow(prepared.columns), staging);
    const refCheckCase = REF_CHECK_ORDER.map((r, i) => `WHEN ${i} THEN '${r}'`).join(' ');
    try {
      await this.storage.copyToParquet(
        `SELECT
           '${kitId}' AS kit_id,
           CASE chrom WHEN 23 THEN 'X' WHEN 24 THEN 'Y' WHEN 25 THEN 'MT' ELSE CAST(chrom AS VARCHAR) END AS chrom,
           CAST(pos AS INTEGER) AS pos,
           CASE WHEN ref = 0 THEN NULL ELSE chr(ref) END AS ref,
           CASE WHEN a1 = 0 THEN NULL ELSE chr(a1) END AS a1,
           CASE WHEN a2 = 0 THEN NULL ELSE chr(a2) END AS a2,
           rsid,
           is_nocall = 1 AS is_nocall,
           strand_ambiguous = 1 AS strand_ambiguous,
           CASE ref_check ${refCheckCase} END AS ref_check
         FROM ${ident(staging)}`, // already sorted by (chrom code, pos) in the Rust core
        file,
      );
    } finally {
      await this.storage.dropTable(staging);
    }
    const { rejectedExamples: _, ...meta } = prepared.meta;
    const kit: Kit = {
      ...meta,
      kitId,
      label: label.trim() || `${meta.vendorLabel} ${meta.chipVersion ?? ''}`.trim(),
      sourceName: prepared.sourceName,
      importedAt: new Date().toISOString(),
      referencePack: prepared.referencePack,
      file,
      custody,
    };
    await this.storage.attachParquet(file, viewName(kitId));
    this.kits.push(kit);
    await this.storage.writeJson(KITS_JSON, this.kits);
    this.emit({ type: 'KitImported', kit });
    return kit;
  }

  /**
   * Record a consent basis for a kit imported without one.
   *
   * Calls stay immutable; only the custody record moves, and it moves by
   * appending: the previous basis is kept in `history` so the record still
   * says what was true before. Consent may be added, never quietly rewritten.
   */
  async recordConsent(kitId: string, consentBasis: ConsentBasis, consentNote?: string): Promise<Kit> {
    const kit = this.get(kitId);
    if (!kit) throw new Error(`No kit ${kitId}`);
    const previous = kit.custody;
    kit.custody = {
      ...previous,
      consentBasis,
      consentNote,
      recordedAt: new Date().toISOString(),
      history: [
        ...(previous.history ?? []),
        { consentBasis: previous.consentBasis, consentNote: previous.consentNote, recordedAt: previous.recordedAt },
      ],
    };
    await this.storage.writeJson(KITS_JSON, this.kits);
    this.emit({ type: 'KitImported', kit });
    return kit;
  }

  async delete(kitId: string): Promise<void> {
    const kit = this.get(kitId);
    if (!kit) return;
    await this.storage.detach(viewName(kitId));
    await this.storage.deleteFile(kit.file);
    this.kits = this.kits.filter((k) => k.kitId !== kitId);
    await this.storage.writeJson(KITS_JSON, this.kits);
    this.emit({ type: 'KitDeleted', kitId });
  }

  /** Calls per bin of `binSize` bases, for the coverage overview. */
  density(kitId: string, binSize: number): Promise<DensityBin[]> {
    return this.storage.query<DensityBin>(
      `SELECT chrom, CAST(floor(pos / ${Math.round(binSize)}) AS INTEGER) AS bin,
              CAST(count(*) AS INTEGER) AS calls, CAST(count(*) FILTER (WHERE is_nocall) AS INTEGER) AS "noCalls"
       FROM ${ident(viewName(kitId))} GROUP BY ALL ORDER BY ALL`,
    );
  }

  callsIn(kitId: string, region: Region, limit = 200_000): Promise<CallRow[]> {
    return this.storage.query<CallRow>(
      `SELECT chrom, pos, ref, a1, a2, rsid, is_nocall, strand_ambiguous, ref_check
       FROM ${ident(viewName(kitId))} WHERE chrom = ? AND pos BETWEEN ? AND ? ORDER BY pos LIMIT ${limit}`,
      [region.chrom, region.start, region.end],
    );
  }

  async callAt(kitId: string, chrom: Chrom, pos: number): Promise<CallRow | null> {
    const rows = await this.callsIn(kitId, { chrom, start: pos, end: pos }, 2);
    return rows[0] ?? null;
  }

  /** rsID is a lookup, never the join key (ADR-0008). */
  async findRsid(kitId: string, rsid: string): Promise<CallRow | null> {
    const rows = await this.storage.query<CallRow>(
      `SELECT chrom, pos, ref, a1, a2, rsid, is_nocall, strand_ambiguous, ref_check
       FROM ${ident(viewName(kitId))} WHERE rsid = ? LIMIT 1`,
      [rsid.trim().toLowerCase()],
    );
    return rows[0] ?? null;
  }

  /** Calls per bin across a wide window, with no-calls counted separately. */
  private async binned(kitId: string, region: Region): Promise<TrackItem<CallRow>[]> {
    const size = Math.max(1, Math.ceil((region.end - region.start + 1) / BINS_PER_WINDOW));
    const rows = await this.storage.query<{ b: number; n: number; nc: number }>(
      `SELECT CAST(floor((pos - ?) / ${size}) AS INTEGER) AS b, CAST(count(*) AS INTEGER) AS n,
              CAST(count(*) FILTER (WHERE is_nocall) AS INTEGER) AS nc
       FROM ${ident(viewName(kitId))} WHERE chrom = ? AND pos BETWEEN ? AND ? GROUP BY 1`,
      [region.start, region.chrom, region.start, region.end],
    );
    return rows.map((r) => ({
      id: `bin:${r.b}`,
      start: region.start + r.b * size,
      end: region.start + (r.b + 1) * size - 1,
      count: r.n,
      value: r.nc,
      label: `${r.n.toLocaleString('en-US')} calls${r.nc ? `, ${r.nc} no-calls` : ''}`,
      row: null as unknown as CallRow,
    }));
  }

  /** The kit's calls as a measured track (ADR-0005). */
  trackSource(kitId: string): TrackSource<CallRow> {
    const kit = this.get(kitId)!;
    return {
      descriptor: {
        id: `kit:${kitId}`,
        kind: 'variant',
        build: 'GRCh37',
        title: 'My calls',
        source: `${kit.vendorLabel} ${kit.chipVersion ?? ''}`.trim(),
        version: kit.importer,
        evidenceKind: 'measured',
      },
      itemsIn: async (region) => {
        if (region.end - region.start > BIN_ABOVE_BP) return this.binned(kitId, region);
        const rows = await this.callsIn(kitId, region);
        return rows.map((r): TrackItem<CallRow> => ({
          id: `${r.chrom}:${r.pos}`,
          start: r.pos,
          end: r.pos,
          label: r.rsid,
          state: r.is_nocall ? 'no-call' : r.strand_ambiguous ? 'strand-ambiguous' : undefined,
          row: r,
        }));
      },
    };
  }
}

export function viewName(kitId: string): string {
  return `kit_${kitId.replaceAll('-', '')}`;
}

export function formatCall(r: Pick<CallRow, 'a1' | 'a2' | 'is_nocall'>): string {
  if (r.is_nocall || !r.a1) return '—';
  return r.a2 ? `${r.a1}/${r.a2}` : r.a1;
}

function toArrow(c: ImportColumns): Table {
  const rsid = makeVector(
    makeData({ type: new Utf8(), length: c.pos.length, nullCount: 0, valueOffsets: c.rsidOffsets, data: c.rsidData }),
  );
  return new Table({
    chrom: makeVector(c.chrom),
    pos: makeVector(c.pos),
    ref: makeVector(c.ref),
    a1: makeVector(c.a1),
    a2: makeVector(c.a2),
    is_nocall: makeVector(c.isNocall),
    strand_ambiguous: makeVector(c.strandAmbiguous),
    ref_check: makeVector(c.refCheck),
    rsid,
  });
}
