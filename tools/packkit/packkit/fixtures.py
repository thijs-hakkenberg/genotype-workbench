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
    kit = [l.split("\t") for l in KIT.read_text().splitlines() if l and not l.startswith("#")]
    code = {"X": 23, "Y": 24, "MT": 25}
    con.register("kit", pa.table({
        "chrom": pa.array([code.get(r[1]) or int(r[1]) for r in kit], pa.uint8()),
        "pos": pa.array([int(r[2]) for r in kit], pa.uint32()),
        "rsid": pa.array([r[0] for r in kit], pa.string()),
    }))
    manifests = [json.loads(p.read_text()) | {"_dir": p.parent} for p in sorted(DIST.glob("*/*/manifest.json"))]
    manifests = [m for m in manifests if m["id"] in specs]
    cut: dict[str, Path] = {}

    def order(m):  # conditions and merges are cut from the ClinVar/GWAS fixtures
        return m.get("role") in ("conditions", "rsid-merges")

    for m in sorted(manifests, key=order):
        src = m["_dir"] / m["file"]
        dest_dir = OUT / m["id"] / m["version"]
        dest_dir.mkdir(parents=True)
        dest = dest_dir / m["file"]
        role = m.get("role")
        if role == "reference":
            sql = f"SELECT r.* FROM '{src}' r JOIN kit k USING (chrom, pos) ORDER BY chrom, pos"
        elif role == "genes":
            sql = f"SELECT * FROM '{src}' WHERE {gene_where}"
        elif role == "conditions":
            clinvar = cut.get("classification")
            sql = (f"SELECT * FROM '{src}' WHERE mondo_id IN (SELECT DISTINCT unnest(condition_mondo) FROM '{clinvar}')"
                   if clinvar else f"SELECT * FROM '{src}' LIMIT 0")
        elif role == "rsid-merges":
            rs = ["SELECT rsid FROM kit"] + [f"SELECT rsid FROM '{cut[r]}'" for r in ("classification", "association") if r in cut]
            sql = f"SELECT * FROM '{src}' WHERE old_rsid IN ({' UNION '.join(rs)}) OR new_rsid IN ({' UNION '.join(rs)})"
        elif role in ("haplotree-mt", "haplotree-y"):
            sql = f"SELECT * FROM '{src}'"
        else:
            sql = f"SELECT * FROM '{src}' WHERE {where}"
        con.sql(f"COPY ({sql}) TO '{dest}' (FORMAT parquet, COMPRESSION zstd)")
        cut[role] = dest
        write_manifest(BuiltPack(specs[m["id"]], m["version"], m.get("sourceDate"), dest, {"fixture": True}))
        print(f"  fixture {m['id']}: {dest.stat().st_size / 1e3:.0f} kB")
    return write_index(OUT, OUT / "test-key.pem", OUT / "test-key.pub")
