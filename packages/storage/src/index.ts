/**
 * Storage adapter (ADR-0003, Decisions D1 sensitivity point).
 *
 * Kits and packs are Parquet files in the Origin Private File System, queried
 * with DuckDB-WASM. Small metadata (kits, custody, packs, grants) is JSON in
 * OPFS. Everything above this package talks to it through this interface, so
 * a Tauri shell can swap in native files and native DuckDB later.
 */
import * as duckdb from '@duckdb/duckdb-wasm';
import type { Table } from 'apache-arrow';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

export type Row = Record<string, unknown>;

export interface StorageEstimate {
  usage: number;
  quota: number;
  persisted: boolean;
}

export interface StorageAdapter {
  /** Write a file (e.g. a downloaded pack) into storage. */
  putFile(path: string, data: Uint8Array): Promise<void>;
  hasFile(path: string): Promise<boolean>;
  deleteFile(path: string): Promise<void>;
  readJson<T>(path: string): Promise<T | null>;
  writeJson(path: string, value: unknown): Promise<void>;
  /** Make a stored Parquet file queryable as a view. */
  attachParquet(path: string, view: string): Promise<void>;
  detach(view: string): Promise<void>;
  /** Write the result of a query to a Parquet file in storage. */
  copyToParquet(selectSql: string, path: string): Promise<void>;
  insertArrow(table: Table, name: string): Promise<void>;
  dropTable(name: string): Promise<void>;
  query<T extends object = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  queryArrow(sql: string, params?: unknown[]): Promise<Table>;
  estimate(): Promise<StorageEstimate>;
}

const fileName = (path: string) => path.replaceAll('/', '__');

async function opfsDir(path: string, create: boolean): Promise<[FileSystemDirectoryHandle, string]> {
  const parts = path.split('/');
  const name = parts.pop()!;
  let dir = await navigator.storage.getDirectory();
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return [dir, name];
}

async function opfsFile(path: string, create: boolean): Promise<FileSystemFileHandle> {
  const [dir, name] = await opfsDir(path, create);
  return dir.getFileHandle(name, { create });
}

export class OpfsDuckDbStorage implements StorageAdapter {
  private registered = new Set<string>();

  private constructor(
    private db: duckdb.AsyncDuckDB,
    private conn: duckdb.AsyncDuckDBConnection,
  ) {}

  /**
   * @param extensionRepository Base URL the app serves DuckDB extensions from
   *   (its own origin). This DuckDB-WASM build ships without Parquet.
   */
  static async open(extensionRepository: string): Promise<OpfsDuckDbStorage> {
    const bundles: duckdb.DuckDBBundles = {
      mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
      eh: { mainModule: ehWasm, mainWorker: ehWorker },
    };
    const bundle = await duckdb.selectBundle(bundles);
    const worker = new Worker(bundle.mainWorker!);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    await db.open({ query: { castBigIntToDouble: true } });
    const conn = await db.connect();
    // Never fetch extensions from the network (principle 1, CSP connect-src 'self').
    await conn.query(`SET autoinstall_known_extensions = false`);
    await conn.query(`SET autoload_known_extensions = false`);
    await conn.query(`SET custom_extension_repository = '${extensionRepository.replace(/'/g, "''").replace(/\/$/, '')}'`);
    await conn.query(`LOAD parquet`);
    return new OpfsDuckDbStorage(db, conn);
  }

  async putFile(path: string, data: Uint8Array): Promise<void> {
    const handle = await opfsFile(path, true);
    const writable = await handle.createWritable();
    await writable.write(data as Uint8Array<ArrayBuffer>);
    await writable.close();
  }

  async hasFile(path: string): Promise<boolean> {
    try {
      await opfsFile(path, false);
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(path: string): Promise<void> {
    if (this.registered.delete(fileName(path))) await this.db.dropFile(fileName(path)).catch(() => {});
    try {
      const [dir, name] = await opfsDir(path, false);
      await dir.removeEntry(name);
    } catch {
      /* already gone */
    }
  }

  async readJson<T>(path: string): Promise<T | null> {
    try {
      const file = await (await opfsFile(path, false)).getFile();
      return JSON.parse(await file.text()) as T;
    } catch {
      return null;
    }
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    await this.putFile(path, new TextEncoder().encode(JSON.stringify(value, null, 2)));
  }

  private async register(path: string): Promise<string> {
    const name = fileName(path);
    if (this.registered.has(name)) return name;
    const handle = await opfsFile(path, true);
    await this.db.registerFileHandle(name, handle, duckdb.DuckDBDataProtocol.BROWSER_FSACCESS, true);
    this.registered.add(name);
    return name;
  }

  async attachParquet(path: string, view: string): Promise<void> {
    const name = await this.register(path);
    await this.conn.query(`CREATE OR REPLACE VIEW ${ident(view)} AS SELECT * FROM read_parquet('${name}')`);
  }

  async detach(view: string): Promise<void> {
    await this.conn.query(`DROP VIEW IF EXISTS ${ident(view)}`);
  }

  async copyToParquet(selectSql: string, path: string): Promise<void> {
    const name = await this.register(path);
    await this.conn.query(`COPY (${selectSql}) TO '${name}' (FORMAT parquet, COMPRESSION zstd, USE_TMP_FILE false)`);
  }

  async insertArrow(table: Table, name: string): Promise<void> {
    await this.conn.insertArrowTable(table, { name, create: true });
  }

  async dropTable(name: string): Promise<void> {
    await this.conn.query(`DROP TABLE IF EXISTS ${ident(name)}`);
  }

  async queryArrow(sql: string, params: unknown[] = []): Promise<Table> {
    if (params.length === 0) return (await this.conn.query(sql)) as unknown as Table;
    const stmt = await this.conn.prepare(sql);
    try {
      return (await stmt.query(...params)) as unknown as Table;
    } finally {
      await stmt.close();
    }
  }

  async query<T extends object = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const table = await this.queryArrow(sql, params);
    return table.toArray().map((r) => normalizeRow(r.toJSON()) as T);
  }

  async estimate(): Promise<StorageEstimate> {
    const e = await navigator.storage.estimate();
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    return { usage: e.usage ?? 0, quota: e.quota ?? 0, persisted };
  }
}

/** Arrow list and struct values come back as vectors; make them plain JS. */
function normalizeRow(row: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === 'object' && 'toArray' in v && typeof (v as { toArray: unknown }).toArray === 'function') {
      out[k] = Array.from((v as { toArray(): ArrayLike<unknown> }).toArray());
    } else if (typeof v === 'bigint') {
      out[k] = Number(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Quote an identifier built by this app (view names, table names). */
export function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`unsafe identifier '${name}'`);
  return `"${name}"`;
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage.persist?.()) ?? false;
  } catch {
    return false;
  }
}
