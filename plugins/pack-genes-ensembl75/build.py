"""Ensembl 75 gene models: one representative transcript per gene."""

import gzip
import re
from collections import defaultdict
from datetime import date

import pyarrow as pa
import pyarrow.parquet as pq

import locus_py

URL = "https://ftp.ensembl.org/pub/release-75/gtf/homo_sapiens/Homo_sapiens.GRCh37.75.gtf.gz"
BIOTYPES = {"protein_coding", "lincRNA", "antisense", "processed_transcript", "miRNA", "snoRNA", "snRNA", "Mt_tRNA", "Mt_rRNA", "rRNA"}
ATTR = re.compile(r'(\w+) "([^"]*)"')


def build(ctx):
    gtf = ctx.fetch(URL)
    genes: dict[str, dict] = {}
    tx: dict[str, dict] = defaultdict(lambda: {"exons": [], "cds": []})
    with gzip.open(gtf, "rt") as f:
        for line in f:
            if line.startswith("#"):
                continue
            chrom, source, feature, start, end, _, strand, _, attrs = line.rstrip("\n").split("\t")
            if feature not in ("gene", "exon", "CDS"):
                continue
            chrom = locus_py.canonical_chrom(chrom)
            if chrom is None:
                continue
            a = dict(ATTR.findall(attrs))
            biotype = a.get("gene_biotype", source)
            if biotype not in BIOTYPES:
                continue
            start, end = int(start), int(end)
            # Older Ensembl GTFs have no gene lines: derive the gene span from its exons.
            g = genes.setdefault(a["gene_id"], {
                "gene_id": a["gene_id"], "symbol": a.get("gene_name", a["gene_id"]), "biotype": biotype,
                "chrom": chrom, "start": start, "end": end, "strand": strand,
            })
            g["start"], g["end"] = min(g["start"], start), max(g["end"], end)
            if feature == "gene":
                continue
            t = tx[a["transcript_id"]]
            t["gene_id"] = a["gene_id"]
            t["name"] = a.get("transcript_name", a["transcript_id"])
            t["exons" if feature == "exon" else "cds"].append((start, end))

    best: dict[str, tuple] = {}
    for tid, t in tx.items():
        cds_len = sum(e - s + 1 for s, e in t["cds"])
        exon_len = sum(e - s + 1 for s, e in t["exons"])
        score = (cds_len, exon_len)
        if t["gene_id"] not in best or score > best[t["gene_id"]][0]:
            best[t["gene_id"]] = (score, tid)

    rows = defaultdict(list)
    for gid, g in sorted(genes.items(), key=lambda kv: (locus_py.chrom_code(kv[1]["chrom"]), kv[1]["start"])):
        tid = best.get(gid, (None, None))[1]
        t = tx.get(tid) if tid else None
        exons = sorted(t["exons"]) if t else []
        cds = t["cds"] if t else []
        for k, v in g.items():
            rows[k].append(v)
        rows["transcript_id"].append(tid)
        rows["transcript_name"].append(t["name"] if t else None)
        rows["exon_starts"].append([s for s, _ in exons])
        rows["exon_ends"].append([e for _, e in exons])
        rows["cds_start"].append(min(s for s, _ in cds) if cds else None)
        rows["cds_end"].append(max(e for _, e in cds) if cds else None)

    table = pa.table(
        {
            "chrom": pa.array(rows["chrom"], pa.string()),
            "start": pa.array(rows["start"], pa.int32()),
            "end": pa.array(rows["end"], pa.int32()),
            "strand": pa.array(rows["strand"], pa.string()),
            "gene_id": pa.array(rows["gene_id"], pa.string()),
            "symbol": pa.array(rows["symbol"], pa.string()),
            "biotype": pa.array(rows["biotype"], pa.string()),
            "transcript_id": pa.array(rows["transcript_id"], pa.string()),
            "transcript_name": pa.array(rows["transcript_name"], pa.string()),
            "exon_starts": pa.array(rows["exon_starts"], pa.list_(pa.int32())),
            "exon_ends": pa.array(rows["exon_ends"], pa.list_(pa.int32())),
            "cds_start": pa.array(rows["cds_start"], pa.int32()),
            "cds_end": pa.array(rows["cds_end"], pa.int32()),
        }
    )
    version = "75"
    out = ctx.out_dir(version) / "genes-ensembl75.parquet"
    pq.write_table(table, out, compression="zstd")
    return ctx.built(version, out, date(2014, 2, 7), genes=len(table))
