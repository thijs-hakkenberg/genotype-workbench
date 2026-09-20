"""GENCODE gene models mapped to GRCh37 ("lift37"), one transcript per gene.

The representative transcript is the one tagged Ensembl_canonical (or
MANE_Select); genes without either fall back to the longest CDS, then the
longest spliced length.
"""

import gzip
import re
from collections import defaultdict
from datetime import date

import pyarrow as pa
import pyarrow.parquet as pq

import locus_py

URL = "https://ftp.ebi.ac.uk/pub/databases/gencode/Gencode_human/latest_release/GRCh37_mapping/gencode.v50lift37.basic.annotation.gtf.gz"
BIOTYPES = {"protein_coding", "lncRNA", "miRNA", "snoRNA", "snRNA", "Mt_tRNA", "Mt_rRNA", "rRNA", "misc_RNA"}
ATTR = re.compile(r'(\w+) "([^"]*)"')


def build(ctx):
    gtf = ctx.fetch(URL)
    genes: dict[str, dict] = {}
    tx: dict[str, dict] = defaultdict(lambda: {"exons": [], "cds": [], "frames": [], "tags": set()})
    with gzip.open(gtf, "rt") as f:
        for line in f:
            if line.startswith("#"):
                continue
            chrom, _, feature, start, end, _, strand, frame, attrs = line.rstrip("\n").split("\t")
            # GENCODE keeps the terminator out of CDS; include it so the coding
            # sequence ends in a stop and stop-lost changes can be read.
            if feature not in ("gene", "transcript", "exon", "CDS", "stop_codon"):
                continue
            chrom = locus_py.canonical_chrom(chrom)
            if chrom is None:
                continue
            pairs = ATTR.findall(attrs)
            a = dict(pairs)
            if a.get("gene_type") not in BIOTYPES:
                continue
            start, end = int(start), int(end)
            gid = a["gene_id"].split(".")[0]
            g = genes.setdefault(gid, {
                "gene_id": gid, "symbol": a.get("gene_name", gid), "biotype": a["gene_type"],
                "chrom": chrom, "start": start, "end": end, "strand": strand,
            })
            g["start"], g["end"] = min(g["start"], start), max(g["end"], end)
            if feature == "gene":
                continue
            t = tx[a["transcript_id"]]
            t["gene_id"] = gid
            t["name"] = a.get("transcript_name", a["transcript_id"])
            if feature == "transcript":
                t["tags"].update(v for k, v in pairs if k == "tag")
            elif feature == "exon":
                t["exons"].append((start, end))
            else:  # CDS or stop_codon
                t["cds"].append((start, end))
                t["frames"].append(int(frame) if frame.isdigit() else 0)

    best: dict[str, tuple] = {}
    for tid, t in tx.items():
        canonical = "Ensembl_canonical" in t["tags"] or "MANE_Select" in t["tags"]
        score = (canonical, sum(e - s + 1 for s, e in t["cds"]), sum(e - s + 1 for s, e in t["exons"]))
        if t["gene_id"] not in best or score > best[t["gene_id"]][0]:
            best[t["gene_id"]] = (score, tid)

    rows = defaultdict(list)
    for gid, g in sorted(genes.items(), key=lambda kv: (locus_py.chrom_code(kv[1]["chrom"]), kv[1]["start"])):
        tid = best.get(gid, (None, None))[1]
        t = tx.get(tid) if tid else None
        exons = sorted(t["exons"]) if t else []
        cds_blocks = sorted(zip(t["cds"], t["frames"])) if t else []
        cds = [c for c, _ in cds_blocks]
        for k, v in g.items():
            rows[k].append(v)
        rows["transcript_id"].append(tid.split(".")[0] if tid else None)
        rows["transcript_name"].append(t["name"] if t else None)
        rows["canonical"].append(bool(t and best[gid][0][0]))
        rows["exon_starts"].append([s for s, _ in exons])
        rows["exon_ends"].append([e for _, e in exons])
        rows["cds_start"].append(min(s for s, _ in cds) if cds else None)
        rows["cds_end"].append(max(e for _, e in cds) if cds else None)
        rows["cds_starts"].append([s for s, _ in cds])
        rows["cds_ends"].append([e for _, e in cds])
        # GTF frame: bases of this block to skip before the first complete codon
        rows["cds_frames"].append([f for _, f in cds_blocks])

    table = pa.table({
        "chrom": pa.array(rows["chrom"], pa.string()),
        "start": pa.array(rows["start"], pa.int32()),
        "end": pa.array(rows["end"], pa.int32()),
        "strand": pa.array(rows["strand"], pa.string()),
        "gene_id": pa.array(rows["gene_id"], pa.string()),
        "symbol": pa.array(rows["symbol"], pa.string()),
        "biotype": pa.array(rows["biotype"], pa.string()),
        "transcript_id": pa.array(rows["transcript_id"], pa.string()),
        "transcript_name": pa.array(rows["transcript_name"], pa.string()),
        "canonical": pa.array(rows["canonical"], pa.bool_()),
        "exon_starts": pa.array(rows["exon_starts"], pa.list_(pa.int32())),
        "exon_ends": pa.array(rows["exon_ends"], pa.list_(pa.int32())),
        "cds_start": pa.array(rows["cds_start"], pa.int32()),
        "cds_end": pa.array(rows["cds_end"], pa.int32()),
        "cds_starts": pa.array(rows["cds_starts"], pa.list_(pa.int32())),
        "cds_ends": pa.array(rows["cds_ends"], pa.list_(pa.int32())),
        "cds_frames": pa.array(rows["cds_frames"], pa.list_(pa.int8())),
    })
    source_date = ctx.last_modified(URL)
    version = "50lift37"
    out = ctx.out_dir(version) / "genes-gencode.parquet"
    pq.write_table(table, out, compression="zstd")
    return ctx.built(version, out, source_date, genes=len(table), canonical=sum(rows["canonical"]))
