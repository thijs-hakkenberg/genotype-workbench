"""Small fixture packs for tests: real pack rows, cut to a few regions.

Signed with a test-only key (fixtures/packs/test-key.*). The app trusts it only
when built with VITE_PACK_INDEX_PUBKEY set to that key, as the e2e run does.
"""

import json
import shutil
from pathlib import Path

import duckdb
import pyarrow as pa

from .manifest import PackSpec, BuiltPack, all_specs, write_index, write_manifest
from .paths import DIST, REPO

OUT = REPO / "fixtures" / "packs"
KIT = REPO / "fixtures" / "synthetic-kits" / "synthetic-v5-small.txt"
REGIONS = [("2", 136_500_000, 136_700_000), ("17", 41_190_000, 41_290_000)]


def build() -> Path:
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    con = duckdb.connect()
    specs = {s.id: s for s in all_specs()}
    where = " OR ".join(f"(chrom = '{c}' AND pos BETWEEN {a} AND {b})" for c, a, b in REGIONS)
    gene_where = " OR ".join(f"(chrom = '{c}' AND start <= {b} AND \"end\" >= {a})" for c, a, b in REGIONS)
    for m_path in sorted(DIST.glob("*/*/manifest.json")):
        m = json.loads(m_path.read_text())
        src = m_path.parent / m["file"]
        dest_dir = OUT / m["id"] / m["version"]
        dest_dir.mkdir(parents=True)
        dest = dest_dir / m["file"]
        if m["id"] == "reference-grch37":
            code = {"X": 23, "Y": 24, "MT": 25}
            kit = [l.split("\t") for l in KIT.read_text().splitlines() if l and not l.startswith("#")]
            con.register("kit", pa.table({
                "chrom": pa.array([code.get(r[1]) or int(r[1]) for r in kit], pa.uint8()),
                "pos": pa.array([int(r[2]) for r in kit], pa.uint32()),
            }))
            con.sql(f"COPY (SELECT r.* FROM '{src}' r JOIN kit k USING (chrom, pos) ORDER BY chrom, pos) "
                    f"TO '{dest}' (FORMAT parquet, COMPRESSION zstd)")
        elif m["id"] == "genes-ensembl75":
            con.sql(f"COPY (SELECT * FROM '{src}' WHERE {gene_where}) TO '{dest}' (FORMAT parquet, COMPRESSION zstd)")
        else:
            con.sql(f"COPY (SELECT * FROM '{src}' WHERE {where}) TO '{dest}' (FORMAT parquet, COMPRESSION zstd)")
        write_manifest(BuiltPack(specs[m["id"]], m["version"], m.get("sourceDate"), dest, {"fixture": True, **m.get("stats", {})}))
        print(f"  fixture {m['id']}: {dest.stat().st_size / 1e3:.0f} kB")
    return write_index(OUT, OUT / "test-key.pem", OUT / "test-key.pub")
