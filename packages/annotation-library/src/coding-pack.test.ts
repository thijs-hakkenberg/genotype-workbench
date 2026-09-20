/**
 * A pack built before a feature existed does not carry its columns.
 *
 * The iteration-1 gene models have no coding blocks. Asking them for one used
 * to fail deep inside SQL — "Values list \"g\" does not have a column named
 * \"canonical\"" — which is true, but not something a reader can act on.
 */
import { describe, expect, it } from 'vitest';
import type { PackManifest } from '@gw/plugin-sdk';
import { AnnotationLibrary, CODING_PACK_NEEDED } from './index';

const GENCODE_COLUMNS = ['chrom', 'start', 'end', 'strand', 'gene_id', 'symbol', 'biotype',
  'transcript_id', 'transcript_name', 'canonical', 'cds_start', 'cds_end', 'cds_starts', 'cds_ends', 'cds_frames'];
const ENSEMBL75_COLUMNS = ['chrom', 'start', 'end', 'strand', 'gene_id', 'symbol', 'biotype'];

const pack = (id: string, role: string): PackManifest =>
  ({ id, version: '1', role, title: id, build: 'GRCh37', source: { short: id } }) as unknown as PackManifest;

/** Answers DESCRIBE from a schema table and records every other query. */
function fakeStorage(schemas: Record<string, string[]>, installed: PackManifest[]) {
  const asked: string[] = [];
  const storage = {
    asked,
    readJson: async (path: string) =>
      path === 'meta/packs.json' ? installed.map((m) => ({ manifest: m, installedAt: '', file: '' })) : null,
    writeJson: async () => {},
    attachParquet: async () => {},
    detach: async () => {},
    query: async (sql: string) => {
      const describe = /DESCRIBE SELECT \* FROM "?pack_(\w+)"?/.exec(sql);
      if (describe) {
        return (schemas[describe[1]!] ?? []).map((column_name) => ({ column_name }));
      }
      asked.push(sql);
      return /count\(\*\)/.test(sql) ? [{ n: 0 }] : [];
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return storage;
}

const build = async (installed: PackManifest[], schemas: Record<string, string[]>) => {
  const storage = fakeStorage(schemas, installed);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const host = { register: () => {} } as any;
  const library = new AnnotationLibrary(storage, host, new URL('http://localhost/packs/'), '');
  await library.init();
  return { library, storage };
};

describe('a genes pack that predates coding blocks', () => {
  it('says which pack is needed instead of failing inside SQL', async () => {
    const { library, storage } = await build(
      [pack('genes-ensembl75', 'genes'), pack('sequence-grch37', 'sequence')],
      { genes_ensembl75: ENSEMBL75_COLUMNS, sequence_grch37: ['chrom', 'start', 'end', 'seq'] },
    );

    const result = await library.codingCandidates('kit_x');
    expect(result.blocked).toBe(CODING_PACK_NEEDED);
    expect(result.candidates).toEqual([]);
    // The query that would have thrown was never sent.
    expect(storage.asked.some((q: string) => q.includes('canonical'))).toBe(false);
  });

  it('uses the pack that does carry them, even when an older one is installed first', async () => {
    const { library, storage } = await build(
      [pack('genes-ensembl75', 'genes'), pack('genes-gencode', 'genes'), pack('sequence-grch37', 'sequence')],
      {
        genes_ensembl75: ENSEMBL75_COLUMNS,
        genes_gencode: GENCODE_COLUMNS,
        sequence_grch37: ['chrom', 'start', 'end', 'seq'],
      },
    );

    const result = await library.codingCandidates('kit_x');
    expect(result.blocked).toBeNull();
    const coding = storage.asked.filter((q: string) => q.includes('canonical'));
    expect(coding.length).toBeGreaterThan(0);
    expect(coding.every((q: string) => q.includes('pack_genes_gencode'))).toBe(true);
  });

  it('offers no protein track when no installed genes pack can supply one', async () => {
    const { library } = await build(
      [pack('genes-ensembl75', 'genes'), pack('sequence-grch37', 'sequence')],
      { genes_ensembl75: ENSEMBL75_COLUMNS, sequence_grch37: ['chrom', 'start', 'end', 'seq'] },
    );
    expect(library.trackSources().some((t) => t.descriptor.kind === 'protein')).toBe(false);
  });

  it('offers one as soon as a pack that carries coding blocks is installed', async () => {
    const { library } = await build(
      [pack('genes-gencode', 'genes'), pack('sequence-grch37', 'sequence')],
      { genes_gencode: GENCODE_COLUMNS, sequence_grch37: ['chrom', 'start', 'end', 'seq'] },
    );
    expect(library.trackSources().some((t) => t.descriptor.kind === 'protein')).toBe(true);
  });
});
