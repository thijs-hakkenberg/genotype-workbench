/**
 * Annotation Library (supporting context).
 *
 * Reference knowledge arrives only as whole packs listed in a signed index,
 * downloaded in full and joined on this device (ADR-0007). Querying a remote
 * service per variant would reveal which variants a person carries; a whole
 * pack reveals nothing.
 */
import {
  BIN_ABOVE_BP,
  BINS_PER_WINDOW,
  SEQUENCE_BELOW_BP,
  type Chrom,
  type PackIndex,
  type PackManifest,
  type PackRole,
  type PluginManifest,
  type Region,
  type TrackItem,
  type TrackSource,
} from '@gw/plugin-sdk';
import type { PluginHost } from '@gw/plugin-host';
import { ident, type StorageAdapter } from '@gw/storage';
import { SequenceIndex, type CodingTranscript } from '@gw/protein';
import type { ClinvarRow, ConditionRow, FrequencyRow, GeneRow, GwasRow, MergeRow, ProteinRow, SharedLocus } from './rows';
import { classificationRank, classificationShort } from './rows';
import { codonItems, pickTranscript, sequenceItems, type CodonRow, type SequenceItemRow } from './sequence';
import { sha256Hex, verifyIndexSignature } from './verify';

export * from './rows';
export * from './sequence';
export { sha256Hex, verifyIndexSignature } from './verify';
export * from './alleles';

const PACKS_JSON = 'meta/packs.json';

/** Roles for packs installed before manifests carried one (iteration 1). */
const LEGACY_ROLES: Record<string, PackRole> = {
  'reference-grch37': 'reference',
  'genes-ensembl75': 'genes',
  clinvar: 'classification',
  'gwas-catalog': 'association',
  'gnomad-chip': 'frequency',
};

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

export interface FrequencyAnnotation {
  pack: PackManifest;
  /** One row per alternate allele, most common first. */
  rows: FrequencyRow[];
}

export interface Annotations {
  /** Strongest evidence first: review stars, then classification. */
  clinvar: ClinvarRow[];
  /** Strongest association first: smallest p-value. */
  gwas: GwasRow[];
  frequencies: FrequencyAnnotation[];
  genes: GeneRow[];
  /** Mondo records for the conditions ClinVar names here, by Mondo id. */
  conditions: Record<string, ConditionRow>;
  /** rsID merges touching this position's rsIDs. */
  merges: MergeRow[];
  /** Position on the genetic map (cM), interpolated, or null. */
  geneticMap: { cm: number; rate: number | null; pack: PackManifest } | null;
}

export type ClinvarForKitRow = ClinvarRow & {
  a1: string;
  a2: string | null;
  strand_ambiguous: boolean;
  best_p_mlog: number | null;
  best_trait: string | null;
};

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
    for (const p of this.installed) {
      p.manifest.role ??= LEGACY_ROLES[p.manifest.id]!;
      if (p.manifest.id === 'gnomad-chip') p.manifest.evidenceKind = 'population-frequency';
      await this.storage.attachParquet(p.file, packView(p.manifest.id));
    }
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
    const ref = this.installed.find((p) => p.manifest.role === 'reference');
    if (!ref) return null;
    const t = await this.storage.queryArrow(
      `SELECT CAST(chrom AS UTINYINT) AS chrom, CAST(pos AS UINTEGER) AS pos, CAST(ascii(ref) AS UTINYINT) AS base
       FROM ${ident(packView(ref.manifest.id))}`,
    );
    const col = <T>(name: string) => t.getChild(name)!.toArray() as T;
    return {
      columns: { chrom: col<Uint8Array>('chrom'), pos: col<Uint32Array>('pos'), base: col<Uint8Array>('base') },
      pack: `${ref.manifest.id}@${ref.manifest.version}`,
    };
  }

  /** Installed packs with a role, in install order. */
  byRole(role: PackRole): PackManifest[] {
    return this.installed.filter((p) => p.manifest.role === role).map((p) => p.manifest);
  }

  private one(role: PackRole): PackManifest | undefined {
    return this.byRole(role)[0];
  }

  private view(m: PackManifest) {
    return ident(packView(m.id));
  }

  private rowsAt<T>(m: PackManifest | undefined, chrom: Chrom, pos: number): Promise<T[]> {
    if (!m) return Promise.resolve([]);
    return this.storage.query<T & object>(`SELECT * FROM ${this.view(m)} WHERE chrom = ? AND pos = ?`, [chrom, pos]);
  }

  /** Everything installed packs say about one position, strongest evidence first within each source. */
  async annotationsAt(chrom: Chrom, pos: number, rsids: string[] = []): Promise<Annotations> {
    const genes = this.one('genes');
    const [clinvar, gwas, genesAt, frequencies] = await Promise.all([
      this.rowsAt<ClinvarRow>(this.one('classification'), chrom, pos),
      this.rowsAt<GwasRow>(this.one('association'), chrom, pos),
      genes
        ? this.storage.query<GeneRow>(`SELECT * FROM ${this.view(genes)} WHERE chrom = ? AND start <= ? AND "end" >= ?`, [chrom, pos, pos])
        : Promise.resolve([] as GeneRow[]),
      Promise.all(
        this.byRole('frequency').map(async (pack) => ({
          pack,
          rows: (await this.rowsAt<FrequencyRow>(pack, chrom, pos)).sort((a, b) => b.af - a.af),
        })),
      ),
    ]);
    clinvar.sort((a, b) => b.stars - a.stars || classificationRank(a.classification) - classificationRank(b.classification));
    gwas.sort((a, b) => (b.p_mlog ?? 0) - (a.p_mlog ?? 0));
    const allRsids = [...new Set([...rsids, ...clinvar.map((c) => c.rsid), ...gwas.map((g) => g.rsid)].filter((r): r is string => !!r))];
    const [conditions, merges, geneticMap] = await Promise.all([
      this.conditions(clinvar.flatMap((c) => c.condition_mondo ?? []).filter((m): m is string => !!m)),
      this.merges(allRsids),
      this.geneticPosition(chrom, pos),
    ]);
    return { clinvar, gwas, frequencies: frequencies.filter((f) => f.rows.length), genes: genesAt, conditions, merges, geneticMap };
  }

  async conditions(mondoIds: string[]): Promise<Record<string, ConditionRow>> {
    const pack = this.one('conditions');
    const ids = [...new Set(mondoIds)];
    if (!pack || ids.length === 0) return {};
    const rows = await this.storage.query<ConditionRow>(
      `SELECT * FROM ${this.view(pack)} WHERE mondo_id IN (${ids.map(() => '?').join(',')})`, ids);
    return Object.fromEntries(rows.map((r) => [r.mondo_id, r]));
  }

  async merges(rsids: string[]): Promise<MergeRow[]> {
    const pack = this.one('rsid-merges');
    if (!pack || rsids.length === 0) return [];
    const list = rsids.map(() => '?').join(',');
    return this.storage.query<MergeRow>(
      `SELECT * FROM ${this.view(pack)} WHERE old_rsid IN (${list}) OR new_rsid IN (${list}) LIMIT 50`, [...rsids, ...rsids]);
  }

  /** Genetic-map position by linear interpolation between the nearest map points. */
  async geneticPosition(chrom: Chrom, pos: number): Promise<Annotations['geneticMap']> {
    const pack = this.one('genetic-map');
    if (!pack) return null;
    const rows = await this.storage.query<{ pos: number; cm: number; rate: number | null }>(
      `(SELECT pos, cm, rate FROM ${this.view(pack)} WHERE chrom = ? AND pos <= ? ORDER BY pos DESC LIMIT 1)
       UNION ALL
       (SELECT pos, cm, rate FROM ${this.view(pack)} WHERE chrom = ? AND pos > ? ORDER BY pos LIMIT 1)`,
      [chrom, pos, chrom, pos]);
    const [a, b] = [rows.find((r) => r.pos <= pos), rows.find((r) => r.pos > pos)];
    if (!a && !b) return null;
    if (!a || !b) return { cm: (a ?? b)!.cm, rate: (a ?? b)!.rate, pack };
    const t = (pos - a.pos) / (b.pos - a.pos || 1);
    return { cm: a.cm + t * (b.cm - a.cm), rate: a.rate, pack };
  }

  /** Reference bases overlapping a region, from the sequence pack. */
  async sequenceIn(region: Region): Promise<SequenceIndex | null> {
    const pack = this.one('sequence');
    if (!pack) return null;
    const rows = await this.storage.query<{ chrom: Chrom; start: number; end: number; seq: string }>(
      `SELECT * FROM ${this.view(pack)} WHERE chrom = ? AND "end" >= ? AND start <= ? ORDER BY start`,
      [region.chrom, region.start, region.end]);
    return new SequenceIndex(rows);
  }

  /** Coding transcripts overlapping a position, canonical first. */
  async codingTranscriptsAt(chrom: Chrom, pos: number): Promise<(GeneRow & CodingTranscript)[]> {
    const genes = this.one('genes');
    if (!genes) return [];
    const rows = await this.storage.query<GeneRow>(
      `SELECT * FROM ${this.view(genes)}
       WHERE chrom = ? AND cds_start <= ? AND cds_end >= ? AND len(cds_starts) > 0`, [chrom, pos, pos]);
    return rows.filter((g) => g.cds_starts?.length) as (GeneRow & CodingTranscript)[];
  }

  /** The protein a transcript makes, from the proteins pack. */
  async proteinFor(transcriptId: string | null, symbol?: string): Promise<ProteinRow | null> {
    const pack = this.one('proteins');
    if (!pack || (!transcriptId && !symbol)) return null;
    const rows = await this.storage.query<ProteinRow>(
      `SELECT * FROM ${this.view(pack)}
       WHERE (? IS NOT NULL AND list_contains(transcripts, ?)) OR (? IS NOT NULL AND symbol = ?)
       ORDER BY list_contains(transcripts, ?) DESC, length DESC LIMIT 1`,
      [transcriptId, transcriptId, symbol ?? null, symbol ?? null, transcriptId]);
    return rows[0] ?? null;
  }

  /** All rows of a table-like pack (e.g. a haplogroup tree), for analysis plugins. */
  async allRows<T extends object>(role: PackRole): Promise<{ pack: PackManifest; rows: T[] } | null> {
    const pack = this.one(role);
    if (!pack) return null;
    return { pack, rows: await this.storage.query<T>(`SELECT * FROM ${this.view(pack)}`) };
  }

  /** Gene symbol lookup for the search box. */
  async findGene(symbol: string): Promise<GeneRow | null> {
    const genes = this.one('genes');
    if (!genes) return null;
    const rows = await this.storage.query<GeneRow>(
      `SELECT * FROM ${this.view(genes)} WHERE upper(symbol) = upper(?)
       ORDER BY biotype = 'protein_coding' DESC LIMIT 1`, [symbol.trim()]);
    return rows[0] ?? null;
  }

  /** The current rsID for a retired one, if dbSNP merged it. */
  async currentRsid(rsid: string): Promise<string | null> {
    const pack = this.one('rsid-merges');
    if (!pack) return null;
    const rows = await this.storage.query<{ new_rsid: string }>(
      `SELECT new_rsid FROM ${this.view(pack)} WHERE old_rsid = ? LIMIT 1`, [rsid.trim().toLowerCase()]);
    return rows[0]?.new_rsid ?? null;
  }

  /** rsID lookup in packs, for rsIDs the kit does not carry. rsID is a lookup, never a join key. */
  async findRsid(rsid: string): Promise<{ chrom: Chrom; pos: number } | null> {
    for (const m of [...this.byRole('classification'), ...this.byRole('association')]) {
      const rows = await this.storage.query<{ chrom: Chrom; pos: number }>(
        `SELECT chrom, pos FROM ${this.view(m)} WHERE rsid = ? LIMIT 1`, [rsid.trim().toLowerCase()]);
      if (rows[0]) return rows[0];
    }
    return null;
  }

  /**
   * Where the kit's calls carry an allele that ClinVar classifies: counts per
   * classification. States what the source says; computes no score.
   */
  async clinvarOverlap(kitView: string): Promise<CallOverlap[]> {
    const clinvar = this.one('classification');
    if (!clinvar) return [];
    return this.storage.query<CallOverlap>(
      `SELECT c.classification, CAST(count(*) AS INTEGER) AS n
       FROM ${this.view(clinvar)} c JOIN ${ident(kitView)} k
         ON k.chrom = c.chrom AND k.pos = c.pos AND NOT k.is_nocall AND (k.a1 = c.alt OR k.a2 = c.alt)
       GROUP BY 1 ORDER BY 2 DESC`);
  }

  /**
   * One row per locus two kits both called, with how many alleles they share
   * and where the locus sits on the genetic map.
   *
   * This is the whole of kinship's data access. The join is what DuckDB is
   * for; the walk over the result is the analysis, and it lives in the plugin.
   *
   * `ibs` — identity by state — is 2 when the genotypes are the same, 1 when
   * they share one allele, 0 when they share none. Only 0 is decisive: two
   * people who inherited a stretch from the same ancestor cannot disagree
   * completely anywhere in it, so a 0 ends a segment. Sharing is not evidence
   * of descent on its own, which is why the walk needs a run and not a locus.
   *
   * No-calls and indels are excluded: an unresolved indel has no alleles to
   * compare, and a no-call would read as a false break.
   */
  async sharedLoci(viewA: string, viewB: string): Promise<SharedLocus[]> {
    const map = this.one('genetic-map');
    // The map has a row at every chip locus already, so an exact join covers
    // almost everything; ASOF carries the rest to the nearest point below.
    const cm = map
      ? `ASOF LEFT JOIN ${this.view(map)} m ON m.chrom = a.chrom AND m.pos <= a.pos`
      : '';
    // Autosomes only. A shared X segment means something different in each
    // sex, Y and MT do not recombine at all, and none of them belongs in a
    // centimorgan total; they need their own analysis, not this one.
    //
    // Allele pairs are not canonically ordered — a vendor may write AG or GA
    // for the same call — so equality has to be order-independent.
    return this.storage.query<SharedLocus>(
      `SELECT a.chrom, a.pos, ${map ? 'm.cm' : 'NULL'} AS cm,
              CASE WHEN least(a.a1, a.a2) = least(b.a1, b.a2)
                    AND greatest(a.a1, a.a2) = greatest(b.a1, b.a2) THEN 2
                   WHEN a.a1 IN (b.a1, b.a2) OR a.a2 IN (b.a1, b.a2) THEN 1
                   ELSE 0 END AS ibs,
              (a.a1 <> a.a2) AS het_a, (b.a1 <> b.a2) AS het_b
       FROM ${ident(viewA)} a
       JOIN ${ident(viewB)} b ON a.chrom = b.chrom AND a.pos = b.pos
       ${cm}
       WHERE NOT a.is_nocall AND NOT b.is_nocall
         AND a.a2 IS NOT NULL AND b.a2 IS NOT NULL
         AND a.chrom NOT IN ('X', 'Y', 'MT')
         AND a.ref_check <> 'indel-unresolved' AND b.ref_check <> 'indel-unresolved'
       ORDER BY a.chrom, a.pos`);
  }

  /**
   * ClinVar records whose allele the kit carries, strongest evidence first:
   * review stars, then the strongest GWAS association at the same position.
   */
  async clinvarForKit(kitView: string, classification: string | null, limit = 1000): Promise<ClinvarForKitRow[]> {
    const clinvar = this.one('classification');
    if (!clinvar) return [];
    const gwas = this.one('association');
    const best = gwas
      ? `LEFT JOIN (SELECT chrom, pos, max(p_mlog) AS best_p_mlog, arg_max(trait, p_mlog) AS best_trait
                    FROM ${this.view(gwas)} GROUP BY ALL) g ON g.chrom = c.chrom AND g.pos = c.pos`
      : '';
    const bestCols = gwas ? 'g.best_p_mlog, g.best_trait' : 'NULL AS best_p_mlog, NULL AS best_trait';
    const where = classification ? 'AND c.classification = ?' : '';
    return this.storage.query<ClinvarForKitRow>(
      `SELECT c.*, k.a1, k.a2, k.strand_ambiguous, ${bestCols}
       FROM ${this.view(clinvar)} c JOIN ${ident(kitView)} k
         ON k.chrom = c.chrom AND k.pos = c.pos AND NOT k.is_nocall AND (k.a1 = c.alt OR k.a2 = c.alt)
       ${best}
       WHERE true ${where}
       ORDER BY c.stars DESC, best_p_mlog DESC NULLS LAST, c.chrom, c.pos LIMIT ${limit}`,
      classification ? [classification] : []);
  }

  /**
   * Associations the kit carries an allele for, strongest first. The reported
   * allele is matched on either strand; the view says which reading was used.
   */
  async topAssociationsForKit(kitView: string, limit = 50): Promise<(GwasRow & { a1: string; a2: string | null; ref: string | null })[]> {
    const gwas = this.one('association');
    if (!gwas) return [];
    const comp = `CASE g.risk_allele WHEN 'A' THEN 'T' WHEN 'T' THEN 'A' WHEN 'C' THEN 'G' WHEN 'G' THEN 'C' END`;
    return this.storage.query(
      `SELECT g.*, k.a1, k.a2, k.ref FROM ${this.view(gwas)} g JOIN ${ident(kitView)} k
         ON k.chrom = g.chrom AND k.pos = g.pos
       WHERE NOT k.is_nocall AND g.risk_allele IS NOT NULL
         AND (k.a1 IN (g.risk_allele, ${comp}) OR k.a2 IN (g.risk_allele, ${comp}))
       ORDER BY g.p_mlog DESC NULLS LAST LIMIT ${limit}`);
  }

  /** Alleles the kit carries that are uncommon in the frequency pack, rarest first. */
  async rarestAllelesForKit(kitView: string, below = 0.05, limit = 50): Promise<(FrequencyRow & { a1: string; a2: string | null; rsid: string })[]> {
    const freq = this.one('frequency');
    if (!freq) return [];
    return this.storage.query(
      `SELECT f.*, k.a1, k.a2, k.rsid FROM ${this.view(freq)} f JOIN ${ident(kitView)} k
         ON k.chrom = f.chrom AND k.pos = f.pos
       WHERE NOT k.is_nocall AND (k.a1 = f.alt OR k.a2 = f.alt) AND f.af < ${below} AND f.af > 0
       ORDER BY f.af LIMIT ${limit}`);
  }

  /** Genes matching a search, with how many of the kit's calls fall inside each. */
  async genesWithCalls(kitView: string | null, query: string, limit = 40): Promise<(GeneRow & { calls: number })[]> {
    const genes = this.one('genes');
    if (!genes) return [];
    const like = `%${query.trim()}%`;
    const counted = kitView
      ? `(SELECT CAST(count(*) AS INTEGER) FROM ${ident(kitView)} k WHERE k.chrom = g.chrom AND k.pos BETWEEN g.start AND g."end")`
      : '0';
    return this.storage.query(
      `SELECT g.*, ${counted} AS calls FROM ${this.view(genes)} g
       WHERE g.symbol ILIKE ? OR g.gene_id ILIKE ?
       ORDER BY (upper(g.symbol) = upper(?)) DESC, (g.biotype = 'protein_coding') DESC, length(g.symbol) LIMIT ${limit}`,
      [like, like, query.trim()]);
  }

  /**
   * Coding positions where the kit differs from the reference, with the
   * transcript blocks and reference bases needed to translate them. The
   * consequence itself is computed in `@gw/protein`, on this device.
   */
  async codingCandidates(kitView: string, limit = 60_000): Promise<{
    candidates: (CodingTranscript & { pos: number; rsid: string; a1: string; a2: string | null; ref: string; symbol: string })[];
    sequence: SequenceIndex;
    /** How many coding positions differ from the reference in total, before the cap. */
    total: number;
  }> {
    const genes = this.one('genes');
    const seq = this.one('sequence');
    if (!genes || !seq) return { candidates: [], sequence: new SequenceIndex([]), total: 0 };
    const inBlock = `len(list_filter(range(1, len(g.cds_starts) + 1), i -> k.pos BETWEEN g.cds_starts[i] AND g.cds_ends[i])) > 0`;
    const where = `NOT k.is_nocall AND k.ref IS NOT NULL AND (k.a1 <> k.ref OR (k.a2 IS NOT NULL AND k.a2 <> k.ref))
                   AND g.canonical AND ${inBlock}`;
    const candidates = await this.storage.query<never>(
      `SELECT k.chrom, k.pos, k.rsid, k.a1, k.a2, k.ref, g.symbol, g.strand, g.transcript_id, g.transcript_name,
              g.cds_starts, g.cds_ends, g.cds_frames
       FROM ${ident(kitView)} k JOIN ${this.view(genes)} g
         ON g.chrom = k.chrom AND k.pos BETWEEN g.cds_start AND g.cds_end
       WHERE ${where} LIMIT ${limit}`);
    const [{ n: total }] = await this.storage.query<{ n: number }>(
      `SELECT CAST(count(*) AS INTEGER) AS n FROM ${ident(kitView)} k JOIN ${this.view(genes)} g
         ON g.chrom = k.chrom AND k.pos BETWEEN g.cds_start AND g.cds_end WHERE ${where}`) as [{ n: number }];
    const ranges = await this.storage.query<{ chrom: Chrom; start: number; end: number; seq: string }>(
      `SELECT DISTINCT s.chrom, s.start, s."end", s.seq FROM ${this.view(seq)} s
       WHERE EXISTS (
         SELECT 1 FROM ${ident(kitView)} k JOIN ${this.view(genes)} g
           ON g.chrom = k.chrom AND k.pos BETWEEN g.cds_start AND g.cds_end
         WHERE ${where} AND s.chrom = k.chrom AND s."end" >= k.pos - 3 AND s.start <= k.pos + 3)`);
    return { candidates, sequence: new SequenceIndex(ranges), total };
  }

  /** Annotation tracks, each encoded by its pack's evidence kind. */
  trackSources(): TrackSource[] {
    return [
      ...this.byRole('genes').map((m) => this.geneTrack(m)),
      ...this.byRole('classification').map((m) => this.clinvarTrack(m)),
      ...this.byRole('association').map((m) => this.gwasTrack(m)),
      ...this.byRole('frequency').map((m) => this.frequencyTrack(m)),
      ...this.byRole('sequence').map((m) => this.sequenceTrack(m)),
      ...(this.one('sequence') && this.one('genes') ? [this.proteinTrack(this.one('sequence')!)] : []),
    ];
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
  private async binned<T>(m: PackManifest, region: Region, strongest: string): Promise<TrackItem<T>[]> {
    const size = Math.max(1, Math.ceil((region.end - region.start + 1) / BINS_PER_WINDOW));
    const rows = await this.storage.query<{ b: number; n: number; w: number | null }>(
      `SELECT CAST(floor((pos - ?) / ${size}) AS INTEGER) AS b, CAST(count(*) AS INTEGER) AS n, CAST(${strongest} AS DOUBLE) AS w
       FROM ${this.view(m)} WHERE chrom = ? AND pos BETWEEN ? AND ? GROUP BY 1`,
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

  private inRegion<T>(m: PackManifest, region: Region, limit = 20_000) {
    return this.storage.query<T & object>(
      `SELECT * FROM ${this.view(m)} WHERE chrom = ? AND pos BETWEEN ? AND ? ORDER BY pos LIMIT ${limit}`,
      [region.chrom, region.start, region.end]);
  }

  private geneTrack(m: PackManifest): TrackSource<GeneRow> {
    return {
      descriptor: this.descriptor(m, 'Gene models'),
      itemsIn: async (region) => {
        const rows = await this.storage.query<GeneRow>(
          `SELECT * FROM ${this.view(m)} WHERE chrom = ? AND start <= ? AND "end" >= ?
           ORDER BY (biotype = 'protein_coding') DESC, "end" - start DESC LIMIT 400`,
          [region.chrom, region.end, region.start]);
        return rows.map((r): TrackItem<GeneRow> => ({ id: r.gene_id, start: r.start, end: r.end, label: r.symbol, row: r }));
      },
    };
  }

  private clinvarTrack(m: PackManifest): TrackSource<ClinvarRow> {
    return {
      descriptor: this.descriptor(m, 'ClinVar'),
      itemsIn: async (region) =>
        this.wide(region)
          ? this.binned<ClinvarRow>(m, region, 'max(stars)')
          : (await this.inRegion<ClinvarRow>(m, region)).map((r) => ({
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
        this.wide(region)
          ? this.binned<GwasRow>(m, region, 'max(p_mlog)')
          : (await this.inRegion<GwasRow>(m, region)).map((r, i) => ({
              id: `${r.chrom}:${r.pos}:${r.study_accession}:${i}`,
              start: r.pos,
              end: r.pos,
              label: r.trait,
              weight: r.p_mlog ?? 0,
              row: r,
            })),
    };
  }

  /** The reference bases themselves, drawn only when the window is small enough to read. */
  private sequenceTrack(m: PackManifest): TrackSource<SequenceItemRow> {
    return {
      descriptor: {
        ...this.descriptor(m, 'Reference sequence'),
        kind: 'sequence',
        emptyMessage: 'No reference bases here: this pack covers coding exons and chip positions',
      },
      itemsIn: async (region) => {
        if (region.end - region.start > SEQUENCE_BELOW_BP) return [];
        const rows = await this.storage.query<{ chrom: Chrom; start: number; end: number; seq: string }>(
          `SELECT * FROM ${this.view(m)} WHERE chrom = ? AND "end" >= ? AND start <= ? ORDER BY start LIMIT 500`,
          [region.chrom, region.start, region.end]);
        return sequenceItems(rows, region.chrom);
      },
    };
  }

  /** Codons and amino acids of the coding transcript in view. */
  private proteinTrack(seqPack: PackManifest): TrackSource<CodonRow> {
    const genes = this.one('genes')!;
    return {
      descriptor: {
        id: 'pack:protein',
        kind: 'protein',
        build: genes.build,
        source: `${genes.source.short} + ${seqPack.source.short}`,
        version: genes.version,
        evidenceKind: 'documentary',
        title: 'Protein',
        licence: genes.licence,
        emptyMessage: 'No coding sequence in this window',
      },
      itemsIn: async (region) => {
        if (region.end - region.start > SEQUENCE_BELOW_BP) return [];
        const rows = await this.storage.query<GeneRow>(
          `SELECT * FROM ${this.view(genes)}
           WHERE chrom = ? AND cds_start <= ? AND cds_end >= ? AND len(cds_starts) > 0`,
          [region.chrom, region.end, region.start]);
        const tx = pickTranscript(rows);
        const sequence = await this.sequenceIn(region);
        if (!tx || !sequence) return [];
        return codonItems(tx, sequence, region);
      },
    };
  }

  private frequencyTrack(m: PackManifest): TrackSource<FrequencyRow> {
    return {
      descriptor: this.descriptor(m, `${m.source.short} frequency`),
      itemsIn: async (region) =>
        this.wide(region)
          ? this.binned<FrequencyRow>(m, region, 'avg(af)')
          : (await this.inRegion<FrequencyRow>(m, region)).map((r) => ({
              id: `${m.id}:${r.chrom}:${r.pos}:${r.alt}`,
              start: r.pos,
              end: r.pos,
              label: `${r.alt} ${(r.af * 100).toFixed(1)}%`,
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
