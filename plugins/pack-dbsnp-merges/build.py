"""dbSNP merge history, kept only where it touches rsIDs the app can meet.

The 800 MB refsnp-merged file (one JSON object per retired rsID) is streamed
through bzip2 and scanned with a regex rather than a full JSON parse. A row is
kept when the old or the new rsID appears on a consumer chip, in ClinVar or in
the GWAS Catalog.
"""

import re
import shutil
import subprocess
import sys
from datetime import date

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

URL = "https://ftp.ncbi.nlm.nih.gov/snp/latest_release/JSON/refsnp-merged.json.bz2"
OLD = re.compile(rb'"refsnp_id":\s*"(\d+)"')
NEW = re.compile(rb'"merged_into":\s*\[\s*"(\d+)"')
BUILD = re.compile(rb'"last_update_build_id":\s*"?(\d+)')


def _wanted(ctx) -> set[bytes]:
    ids = {r[2:].encode() for r in ctx.chip_loci().column("rsid").to_pylist() if r.startswith("rs")}
    con = duckdb.connect()
    for pack in ("clinvar", "gwas-catalog"):
        try:
            path = ctx.latest(pack)
        except SystemExit:
            continue
        for (r,) in con.sql(f"SELECT DISTINCT rsid FROM '{path}' WHERE rsid LIKE 'rs%'").fetchall():
            ids.add(r[2:].encode())
    return ids


def build(ctx):
    wanted = _wanted(ctx)
    src = ctx.fetch(URL)
    decompress = ["lbzip2", "-dc"] if shutil.which("lbzip2") else ["bzip2", "-dc"]
    old, new, builds = [], [], []
    seen = 0
    with subprocess.Popen([*decompress, str(src)], stdout=subprocess.PIPE, bufsize=1 << 20) as p:
        for line in p.stdout:
            seen += 1
            o = OLD.search(line)
            n = NEW.search(line)
            if not o or not n or (o.group(1) not in wanted and n.group(1) not in wanted):
                continue
            b = BUILD.search(line)
            old.append("rs" + o.group(1).decode())
            new.append("rs" + n.group(1).decode())
            builds.append(int(b.group(1)) if b else None)
            if seen % 10_000_000 == 0:
                print(f"  {seen:,} merged records scanned, {len(old):,} kept", file=sys.stderr)
    table = pa.table({"old_rsid": old, "new_rsid": new, "build": pa.array(builds, pa.int32())}).sort_by("old_rsid")
    source_date = ctx.last_modified(URL) or date.today()
    version = source_date.isoformat()
    out = ctx.out_dir(version) / "dbsnp-merges.parquet"
    pq.write_table(table, out, compression="zstd")
    return ctx.built(version, out, source_date, scanned=seen, kept=len(old))
