"""ClinVar classifications (GRCh37 VCF), single-nucleotide variants only.

Chip calls are single bases, and I/D chip indels carry no sequence, so only
SNVs can ever join. Everything else is counted in the manifest stats.
"""

import gzip
from datetime import date

import pyarrow as pa
import pyarrow.parquet as pq

import locus_py

URL = "https://ftp.ncbi.nlm.nih.gov/pub/clinvar/vcf_GRCh37/clinvar.vcf.gz"

# Review status -> ClinVar's "gold stars".
STARS = {
    "practice_guideline": 4,
    "reviewed_by_expert_panel": 3,
    "criteria_provided,_multiple_submitters,_no_conflicts": 2,
    "criteria_provided,_conflicting_classifications": 1,
    "criteria_provided,_conflicting_interpretations": 1,
    "criteria_provided,_single_submitter": 1,
}


def _text(v: str | None) -> str | None:
    return v.replace("_", " ") if v else None


def build(ctx):
    vcf = ctx.fetch(URL, refresh=False)
    file_date = None
    cols = {k: [] for k in (
        "chrom", "pos", "ref", "alt", "variation_id", "allele_id", "rsid", "classification",
        "review_status", "stars", "conditions", "condition_mondo", "genes", "consequence", "origin",
    )}
    skipped = {"notSnv": 0, "noAlt": 0, "unknownChrom": 0}
    with gzip.open(vcf, "rt") as f:
        for line in f:
            if line.startswith("#"):
                if line.startswith("##fileDate="):
                    file_date = date.fromisoformat(line.strip().split("=", 1)[1])
                continue
            chrom, pos, vid, ref, alt, _, _, info = line.rstrip("\n").split("\t")[:8]
            if alt in (".", ""):
                skipped["noAlt"] += 1
                continue
            chrom = locus_py.canonical_chrom(chrom)
            if chrom is None:
                skipped["unknownChrom"] += 1
                continue
            try:
                p, r, a = locus_py.trim_variant(int(pos), ref, alt)
            except ValueError:
                skipped["notSnv"] += 1
                continue
            if len(r) != 1 or len(a) != 1:
                skipped["notSnv"] += 1
                continue
            i = dict(kv.split("=", 1) if "=" in kv else (kv, "") for kv in info.split(";"))
            review = i.get("CLNREVSTAT", "")
            genes = [g.split(":")[0] for g in i.get("GENEINFO", "").split("|") if g]
            consequence = sorted({m.split("|")[1] for m in i.get("MC", "").split(",") if "|" in m})
            cols["chrom"].append(chrom)
            cols["pos"].append(p)
            cols["ref"].append(r)
            cols["alt"].append(a)
            cols["variation_id"].append(int(vid))
            cols["allele_id"].append(int(i["ALLELEID"]) if i.get("ALLELEID", "").isdigit() else None)
            cols["rsid"].append(f"rs{i['RS']}" if i.get("RS") else None)
            cols["classification"].append(_text(i.get("CLNSIG")) or "not provided")
            cols["review_status"].append(_text(review))
            cols["stars"].append(STARS.get(review, 0))
            # CLNDN separates conditions with '|'; a comma belongs to a name
            # ("..._1,_susceptibility_to"). CLNDISDB is aligned with CLNDN.
            names = i.get("CLNDN", "").split("|") if i.get("CLNDN") else []
            dbs = i.get("CLNDISDB", "").split("|") if i.get("CLNDISDB") else []
            conds, mondo = [], []
            for n, name in enumerate(names):
                if not name or name in ("not_provided", "not_specified"):
                    continue
                ids = dbs[n].split(",") if n < len(dbs) else []
                conds.append(_text(name))
                mondo.append(next((x.split(":", 1)[1] for x in ids if x.startswith("MONDO:")), None))
            cols["conditions"].append(conds)
            cols["condition_mondo"].append(mondo)
            cols["genes"].append(genes)
            cols["consequence"].append([_text(c) for c in consequence])
            cols["origin"].append(i.get("ORIGIN"))

    table = pa.table(
        {
            "chrom": pa.array(cols["chrom"], pa.string()),
            "pos": pa.array(cols["pos"], pa.int32()),
            "ref": pa.array(cols["ref"], pa.string()),
            "alt": pa.array(cols["alt"], pa.string()),
            "variation_id": pa.array(cols["variation_id"], pa.int64()),
            "allele_id": pa.array(cols["allele_id"], pa.int64()),
            "rsid": pa.array(cols["rsid"], pa.string()),
            "classification": pa.array(cols["classification"], pa.string()),
            "review_status": pa.array(cols["review_status"], pa.string()),
            "stars": pa.array(cols["stars"], pa.int8()),
            "conditions": pa.array(cols["conditions"], pa.list_(pa.string())),
            "condition_mondo": pa.array(cols["condition_mondo"], pa.list_(pa.string())),
            "genes": pa.array(cols["genes"], pa.list_(pa.string())),
            "consequence": pa.array(cols["consequence"], pa.list_(pa.string())),
            "origin": pa.array(cols["origin"], pa.string()),
        }
    )
    source_date = file_date or ctx.last_modified(URL)
    version = source_date.isoformat() if source_date else date.today().isoformat()
    out = ctx.out_dir(version) / "clinvar.parquet"
    pq.write_table(table, out, compression="zstd", row_group_size=200_000)
    return ctx.built(version, out, source_date, snvs=len(table), skipped=skipped)
