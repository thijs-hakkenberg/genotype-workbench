"""GWAS Catalog associations, lifted from GRCh38 to GRCh37.

Only single-variant associations with a position are kept; haplotype and
interaction rows (several SNPs in one row) are counted and dropped. The risk
allele is as the study reported it; strand is not guaranteed by the source.
"""

import zipfile
from datetime import date

import pyarrow as pa
import pyarrow.parquet as pq
from pyliftover import LiftOver

import locus_py

URL = "https://ftp.ebi.ac.uk/pub/databases/gwas/releases/latest/gwas-catalog-associations_ontology-annotated-full.zip"
CHAIN = "https://hgdownload.soe.ucsc.edu/goldenPath/hg38/liftOver/hg38ToHg19.over.chain.gz"


def build(ctx):
    z = ctx.fetch(URL)
    tsv = ctx.cache / "gwas-catalog-associations.tsv"
    if not tsv.exists() or tsv.stat().st_mtime < z.stat().st_mtime:
        with zipfile.ZipFile(z) as zf:
            name = next(n for n in zf.namelist() if n.endswith(".tsv"))
            tsv.write_bytes(zf.read(name))
    lo = LiftOver(str(ctx.fetch(CHAIN)))

    con = ctx.duckdb()
    rel = con.sql(f"""
        SELECT
          "CHR_ID" AS chr38, TRY_CAST("CHR_POS" AS BIGINT) AS pos38,
          "SNPS" AS rsid,
          NULLIF(split_part("STRONGEST SNP-RISK ALLELE", '-', -1), '?') AS risk_allele,
          TRY_CAST("RISK ALLELE FREQUENCY" AS DOUBLE) AS risk_allele_freq,
          "DISEASE/TRAIT" AS trait, "MAPPED_TRAIT" AS mapped_trait,
          TRY_CAST("P-VALUE" AS DOUBLE) AS p_value, TRY_CAST("PVALUE_MLOG" AS DOUBLE) AS p_mlog,
          NULLIF("P-VALUE (TEXT)", '') AS p_text,
          TRY_CAST("OR or BETA" AS DOUBLE) AS effect,
          CASE WHEN "95% CI (TEXT)" ILIKE '%increase%' OR "95% CI (TEXT)" ILIKE '%decrease%' THEN 'beta'
               WHEN TRY_CAST("OR or BETA" AS DOUBLE) IS NOT NULL THEN 'or' END AS effect_kind,
          NULLIF("95% CI (TEXT)", '') AS ci_text,
          "PUBMEDID" AS pubmed_id, "FIRST AUTHOR" AS first_author, "DATE" AS pub_date,
          "JOURNAL" AS journal, "STUDY" AS study, "STUDY ACCESSION" AS study_accession,
          "INITIAL SAMPLE SIZE" AS initial_sample, "MAPPED_GENE" AS mapped_gene, "CONTEXT" AS context
        FROM read_csv('{tsv}', delim='\t', header=true, quote='', all_varchar=true, ignore_errors=true)
    """)
    t = rel.arrow() if hasattr(rel, "arrow") else rel.fetch_arrow_table()
    t = t.read_all() if hasattr(t, "read_all") else t
    total = len(t)

    chr38 = t.column("chr38").to_pylist()
    pos38 = t.column("pos38").to_pylist()
    rsids = t.column("rsid").to_pylist()
    cache: dict[tuple[str, int], tuple[str, int] | None] = {}
    keep, chrom37, pos37 = [], [], []
    dropped = {"multiOrNoPosition": 0, "liftoverFailed": 0}
    for i, (c, p, rs) in enumerate(zip(chr38, pos38, rsids)):
        if c is None or p is None or not rs or any(s in rs for s in (";", " x ", ",")):
            dropped["multiOrNoPosition"] += 1
            continue
        key = (c, p)
        if key not in cache:
            hits = lo.convert_coordinate(f"chr{c}", p - 1)  # pyliftover is 0-based
            chrom = locus_py.canonical_chrom(c)
            same = [h for h in (hits or []) if locus_py.canonical_chrom(h[0]) == chrom]
            cache[key] = (chrom, same[0][1] + 1) if len(same) == 1 and chrom else None
        hit = cache[key]
        if hit is None:
            dropped["liftoverFailed"] += 1
            continue
        keep.append(i)
        chrom37.append(hit[0])
        pos37.append(hit[1])

    t = t.take(pa.array(keep)).drop_columns(["chr38", "pos38"])
    t = t.add_column(0, "pos", pa.array(pos37, pa.int32())).add_column(0, "chrom", pa.array(chrom37, pa.string()))
    order = sorted(range(len(t)), key=lambda i: (locus_py.chrom_code(chrom37[i]), pos37[i]))
    t = t.take(pa.array(order))

    source_date = ctx.last_modified(URL) or date.today()
    version = source_date.isoformat()
    out = ctx.out_dir(version) / "gwas-catalog.parquet"
    pq.write_table(t, out, compression="zstd", row_group_size=200_000)
    return ctx.built(version, out, source_date, sourceRows=total, associations=len(t), dropped=dropped)
