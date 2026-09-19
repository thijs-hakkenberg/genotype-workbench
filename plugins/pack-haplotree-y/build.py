"""YFull YTree nodes with the chip-probed SNPs that define them.

YTree names SNPs but gives no coordinates; YBrowse's snps_hg19 table places
them on GRCh37 (chrY) with ancestral and derived alleles. Only SNPs at
consumer-chip Y positions are kept, since no others can ever be read.
"""

import csv
import io
import json
import sys
from datetime import date

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

TREE = "https://raw.githubusercontent.com/YFullTeam/YTree/master/current_tree.json"
VERSION = "https://raw.githubusercontent.com/YFullTeam/YTree/master/current_version.txt"
SNPS = "http://ybrowse.org/gbrowse2/gff/snps_hg19.csv"


def build(ctx):
    tree = json.loads(ctx.fetch(TREE, name="ytree-current_tree.json", refresh=True).read_text())
    version = ctx.fetch(VERSION, name="ytree-current_version.txt", refresh=True).read_text().strip() or date.today().isoformat()
    loci = ctx.chip_loci()
    chip_y = set(loci.filter(pc.equal(loci["chrom"], 24)).column("pos").to_pylist())

    by_name: dict[str, tuple[int, str, str]] = {}
    with open(ctx.fetch(SNPS, name="ybrowse-snps_hg19.csv"), newline="", encoding="utf-8", errors="replace") as f:
        for r in csv.DictReader(f):
            try:
                pos = int(r["start"])
            except (TypeError, ValueError):
                continue
            anc, der = (r.get("allele_anc") or "").upper(), (r.get("allele_der") or "").upper()
            if pos in chip_y and len(anc) == 1 and len(der) == 1 and anc in "ACGT" and der in "ACGT":
                by_name.setdefault(r["Name"], (pos, anc, der))

    rows = {k: [] for k in ("name", "parent", "depth", "snp_names", "pos", "anc", "der")}
    placed = 0

    def walk(node, parent, depth):
        nonlocal placed
        name = node.get("id") or "?"
        names, pos, anc, der, seen = [], [], [], [], set()
        for group in (node.get("snps") or "").split(","):
            aliases = [a.strip() for a in group.split("/") if a.strip()]
            hit = next((by_name[a] for a in aliases if a in by_name), None)
            if hit and hit[0] not in seen:
                seen.add(hit[0])
                names.append(aliases[0])
                pos.append(hit[0])
                anc.append(hit[1])
                der.append(hit[2])
        placed += len(pos)
        for k, v in (("name", name), ("parent", parent), ("depth", depth), ("snp_names", names), ("pos", pos), ("anc", anc), ("der", der)):
            rows[k].append(v)
        for child in node.get("children") or []:
            walk(child, name, depth + 1)

    sys.setrecursionlimit(20000)
    walk(tree, None, 0)
    table = pa.table({
        "name": pa.array(rows["name"], pa.string()),
        "parent": pa.array(rows["parent"], pa.string()),
        "depth": pa.array(rows["depth"], pa.int16()),
        "snp_names": pa.array(rows["snp_names"], pa.list_(pa.string())),
        "pos": pa.array(rows["pos"], pa.list_(pa.int32())),
        "anc": pa.array(rows["anc"], pa.list_(pa.string())),
        "der": pa.array(rows["der"], pa.list_(pa.string())),
    })
    out = ctx.out_dir(version) / "haplotree-y.parquet"
    pq.write_table(table, out, compression="zstd")
    return ctx.built(version, out, date.today(), nodes=len(table), chipSnpsPlaced=placed, chipYLoci=len(chip_y))
