"""1000 Genomes phase 3 allele frequencies, pre-filtered to chip loci.

The 1.5 GB sites VCF is streamed once and filtered on the fly (`bcftools view
-T`, a sequential read), so nothing large is written to disk. Multi-allelic
sites are split so every alternate allele gets its own row. The sampling
interval is a Wilson 95% interval from AC/AN.
"""

import shutil
import subprocess
import sys
from datetime import date

URL = "https://ftp.1000genomes.ebi.ac.uk/vol1/ftp/release/20130502/ALL.wgs.phase3_shapeit2_mvncall_integrated_v5c.20130502.sites.vcf.gz"
NAMES = {**{i: str(i) for i in range(1, 23)}, 23: "X", 24: "Y", 25: "MT"}
GROUPS = ["afr", "amr", "eas", "eur", "sas"]


def build(ctx):
    if not shutil.which("bcftools"):
        sys.exit("freq-1000g needs bcftools (brew install bcftools / apt install bcftools)")
    loci = ctx.chip_loci()
    work = ctx.cache / "freq-1000g"
    work.mkdir(exist_ok=True)
    tsv = work / "sites.tsv"
    if not tsv.exists():
        targets = work / "targets.tsv"
        chrom = loci.column("chrom").to_pylist()
        pos = loci.column("pos").to_pylist()
        targets.write_text("".join(f"{NAMES[c]}\t{p}\n" for c, p in sorted(set(zip(chrom, pos)))))
        fmt = "%CHROM\t%POS\t%REF\t%ALT\t%INFO/AC\t%INFO/AN\t%INFO/AF\t" + "\t".join(f"%INFO/{g.upper()}_AF" for g in GROUPS) + "\n"
        part = tsv.with_suffix(".part")
        print("  streaming 1000 Genomes sites (about 1.5 GB)…", file=sys.stderr)
        view = subprocess.Popen(["bcftools", "view", "-T", str(targets), "-Ou", URL], stdout=subprocess.PIPE, cwd=work)
        norm = subprocess.Popen(["bcftools", "norm", "-m", "-any", "-Ou"], stdin=view.stdout, stdout=subprocess.PIPE)
        with open(part, "w") as f:
            query = subprocess.run(["bcftools", "query", "-f", fmt], stdin=norm.stdout, stdout=f)
        if view.wait() or norm.wait() or query.returncode:
            sys.exit("bcftools failed while streaming 1000 Genomes")
        part.rename(tsv)

    con = ctx.duckdb()
    cols = {"chrom": "VARCHAR", "pos": "INTEGER", "ref": "VARCHAR", "alt": "VARCHAR", "ac": "BIGINT", "an": "BIGINT", "af": "DOUBLE",
            **{f"af_{g}": "DOUBLE" for g in GROUPS}}
    columns = "{" + ", ".join(f"'{k}': '{v}'" for k, v in cols.items()) + "}"
    version = "phase3"
    out = ctx.out_dir(version) / "freq-1000g.parquet"
    con.sql(f"""
        COPY (
          WITH t AS (
            SELECT * FROM read_csv('{tsv}', delim='\t', header=false, columns={columns}, nullstr='.')
            WHERE length(ref) = 1 AND length(alt) = 1 AND an > 0
          ), w AS (SELECT *, 1.959964 AS z, CAST(ac AS DOUBLE) / an AS p FROM t)
          SELECT chrom, pos, ref, alt, ac, an, af,
                 greatest(0, (p + z*z/(2*an) - z*sqrt(p*(1-p)/an + z*z/(4*an*an))) / (1 + z*z/an)) AS af_lo,
                 least(1, (p + z*z/(2*an) + z*sqrt(p*(1-p)/an + z*z/(4*an*an))) / (1 + z*z/an)) AS af_hi,
                 {", ".join(f"af_{g}" for g in GROUPS)}
          FROM w
          ORDER BY CASE chrom WHEN 'X' THEN 23 WHEN 'Y' THEN 24 WHEN 'MT' THEN 25 ELSE CAST(chrom AS INTEGER) END, pos
        ) TO '{out}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 200000)
    """)
    rows = con.sql(f"SELECT count(*) FROM '{out}'").fetchone()[0]
    return ctx.built(version, out, date(2013, 5, 2), sites=rows, chipLoci=len(loci))
