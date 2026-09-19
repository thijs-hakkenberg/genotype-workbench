/// <reference lib="webworker" />
/**
 * Import worker: runs the Rust locus normalizer (WASM) off the main thread.
 * Returns columnar typed arrays, transferred without copying.
 */
import * as Comlink from 'comlink';
import init, { detect_profile, import_kit, locus_version } from '@gw/locus-wasm';
import wasmUrl from '@gw/locus-wasm/locus_wasm_bg.wasm?url';

let ready: Promise<unknown> | null = null;
const boot = () => (ready ??= init({ module_or_path: wasmUrl }));

export interface ImportColumns {
  metaJson: string;
  chrom: Uint8Array;
  pos: Uint32Array;
  ref: Uint8Array;
  a1: Uint8Array;
  a2: Uint8Array;
  isNocall: Uint8Array;
  strandAmbiguous: Uint8Array;
  refCheck: Uint8Array;
  rsidData: Uint8Array;
  rsidOffsets: Int32Array;
}

export interface ReferenceColumns {
  chrom: Uint8Array;
  pos: Uint32Array;
  base: Uint8Array;
}

const api = {
  async version(): Promise<string> {
    await boot();
    return locus_version();
  },

  async detect(head: Uint8Array, profilesJson: string): Promise<string | null> {
    await boot();
    return detect_profile(head, profilesJson) ?? null;
  },

  async importFile(
    bytes: Uint8Array,
    profileJson: string,
    reference: ReferenceColumns,
    onProgress?: (rows: number) => void,
  ): Promise<ImportColumns> {
    await boot();
    const result = import_kit(bytes, profileJson, reference.chrom, reference.pos, reference.base, (n: number) =>
      onProgress?.(n),
    );
    try {
      const cols: ImportColumns = {
        metaJson: result.meta_json(),
        chrom: result.chrom(),
        pos: result.pos(),
        ref: result.ref_base(),
        a1: result.a1(),
        a2: result.a2(),
        isNocall: result.is_nocall(),
        strandAmbiguous: result.strand_ambiguous(),
        refCheck: result.ref_check(),
        rsidData: result.rsid_data(),
        rsidOffsets: result.rsid_offsets(),
      };
      const buffers = Object.values(cols)
        .filter((v): v is ArrayBufferView => ArrayBuffer.isView(v))
        .map((v) => v.buffer as ArrayBuffer);
      return Comlink.transfer(cols, buffers);
    } finally {
      result.free();
    }
  },
};

export type ImportWorkerApi = typeof api;
Comlink.expose(api);
