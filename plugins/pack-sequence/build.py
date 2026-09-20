"""Reference bases where the app can use them: coding exons and chip loci.

The whole genome is 3 Gb, far too much to ship. Coding exons carry the codons
a variant can change, and a small window around every chip position lets the
sequence appear wherever there is a call. Overlapping ranges are merged.
"""

import gzip
import shutil
from datetime import date

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
from pyfaidx import Fasta

URL = "https://ftp.1000genomes.ebi.ac.uk/vol1/ftp/technical/reference/phase2_reference_assembly_sequence/hs37d5.fa.gz"
NAMES = {**{i: str(i) for i in range(1, 23)}, 23: "X", 24: "Y", 25: "MT"}
WINDOW = 25  # bases each side of a chip locus
EXON_PAD = 6  # bases each side of a coding exon, to show the splice edges


def build(ctx):
    fa = ctx.cache / "hs37d5.fa"
    if not fa.exists():
        gz = ctx.fetch(URL)
        part = fa.with_suffix(".fa.part")
        with gzip.open(gz, "rb") as src, open(part, "wb") as dst:
            shutil.copyfileobj(src, dst, 1 << 24)
        part.rename(fa)
    genome = Fasta(str(fa), as_raw=True, sequence_always_upper=True, rebuild=False)

    con = duckdb.connect()
    genes = ctx.latest("genes-gencode")
    ranges: dict[str, list[tuple[int, int]]] = {}
    for chrom, start, end in con.sql(
        f"""SELECT chrom, unnest(cds_starts) - {EXON_PAD} AS s, unnest(cds_ends) + {EXON_PAD} AS e
            FROM '{genes}' WHERE len(cds_starts) > 0""").fetchall():
        ranges.setdefault(chrom, []).append((max(1, start), end))

    loci = ctx.chip_loci()
    for code, pos in zip(loci.column("chrom").to_pylist(), loci.column("pos").to_pylist()):
        name = NAMES.get(code)
        if name:
            ranges.setdefault(name, []).append((max(1, pos - WINDOW), pos + WINDOW))

    rows = {"chrom": [], "start": [], "end": [], "seq": []}
    bases = 0
    for name in [*(str(i) for i in range(1, 23)), "X", "Y", "MT"]:
        if name not in ranges:
            continue
        seq = genome[name][:]
        merged: list[list[int]] = []
        for s, e in sorted(ranges[name]):
            e = min(e, len(seq))
            if merged and s <= merged[-1][1] + 1:
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e])
        for s, e in merged:
            rows["chrom"].append(name)
            rows["start"].append(s)
            rows["end"].append(e)
            rows["seq"].append(seq[s - 1 : e])
            bases += e - s + 1
        del seq

    table = pa.table({
        "chrom": pa.array(rows["chrom"], pa.string()),
        "start": pa.array(rows["start"], pa.int32()),
        "end": pa.array(rows["end"], pa.int32()),
        "seq": pa.array(rows["seq"], pa.string()),
    })
    version = date.today().isoformat()
    out = ctx.out_dir(version) / "sequence-grch37.parquet"
    pq.write_table(table, out, compression="zstd", row_group_size=20_000)
    return ctx.built(version, out, None, ranges=len(table), bases=bases, window=WINDOW)
