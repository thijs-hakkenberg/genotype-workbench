"""gnomAD v2.1.1 genome allele frequencies, pre-filtered to chip loci.

The per-chromosome sites VCFs (about 460 GB together) are streamed once and
filtered on the fly with `bcftools query -T` (targets, sequential read); only
the chip-locus rows are kept. Random access with `-R` was measured at about
2,000 loci per 12 minutes: gnomAD rows are so wide that it fetches most of
the file anyway. Chromosomes stream in parallel (GW_GNOMAD_JOBS, default 4)
and each finished chromosome is cached, so an interrupted run resumes.
gnomAD v2 genomes have no Y or MT calls.
"""

import os
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date

BASE = "https://storage.googleapis.com/gcp-public-data--gnomad/release/2.1.1/vcf/genomes/gnomad.genomes.r2.1.1.sites.{chrom}.vcf.bgz"
CHROMS = [str(i) for i in range(1, 23)] + ["X"]
GROUPS = ["afr", "amr", "asj", "eas", "fin", "nfe", "sas", "oth"]
FIELDS = ["AC", "AN", "AF"] + [f"AF_{g}" for g in GROUPS]
CODE = {**{str(i): i for i in range(1, 23)}, "X": 23}


def build(ctx):
    if not shutil.which("bcftools"):
        sys.exit("gnomad-chip needs bcftools (brew install bcftools / apt install bcftools)")
    loci = ctx.chip_loci()
    work = ctx.cache / "gnomad-chip"
    work.mkdir(exist_ok=True)
    fmt = "%CHROM\t%POS\t%REF\t%ALT\t" + "\t".join(f"%INFO/{f}" for f in FIELDS) + "\n"

    chrom_col = loci.column("chrom").to_numpy()
    all_pos = loci.column("pos").to_numpy()

    def one(chrom: str) -> None:
        out = work / f"{chrom}.tsv"
        if out.exists():
            return
        targets = work / f"{chrom}.targets"
        pos = sorted(set(all_pos[chrom_col == CODE[chrom]].tolist()))
        targets.write_text("".join(f"{chrom}\t{p}\n" for p in pos))
        print(f"  gnomAD chr{chrom}: streaming for {len(pos)} loci", file=sys.stderr)
        part = out.with_suffix(".part")
        view = subprocess.Popen(["bcftools", "view", "-T", str(targets), "-f", "PASS", "-Ou", BASE.format(chrom=chrom)],
                                stdout=subprocess.PIPE, cwd=work)
        norm = subprocess.Popen(["bcftools", "norm", "-m", "-any", "-Ou"], stdin=view.stdout, stdout=subprocess.PIPE)
        with open(part, "w") as f:
            query = subprocess.run(["bcftools", "query", "-f", fmt], stdin=norm.stdout, stdout=f)
        if view.wait() or norm.wait() or query.returncode:
            raise RuntimeError(f"bcftools failed on chr{chrom}")
        part.rename(out)
        print(f"  gnomAD chr{chrom}: done", file=sys.stderr)

    with ThreadPoolExecutor(int(os.environ.get("GW_GNOMAD_JOBS", "4"))) as pool:
        list(pool.map(one, CHROMS))

    con = ctx.duckdb()
    cols = ["chrom VARCHAR", "pos INTEGER", "ref VARCHAR", "alt VARCHAR"] + [
        f"{f.lower()} {'BIGINT' if f in ('AC', 'AN') else 'DOUBLE'}" for f in FIELDS
    ]
    columns = "{" + ", ".join(f"'{c.split()[0]}': '{c.split()[1]}'" for c in cols) + "}"
    version = "2.1.1"
    out = ctx.out_dir(version) / "gnomad-chip.parquet"
    # Wilson score interval (95%) on AF from AC/AN: the band drawn with faded ends.
    con.sql(f"""
        COPY (
          WITH t AS (
            SELECT * FROM read_csv('{work}/*.tsv', delim='\t', header=false, columns={columns}, nullstr='.')
            WHERE length(ref) = 1 AND length(alt) = 1 AND an > 0
          ), w AS (
            SELECT *, 1.959964 AS z, CAST(ac AS DOUBLE) / an AS p FROM t
          )
          SELECT chrom, pos, ref, alt, ac, an, af,
                 greatest(0, (p + z*z/(2*an) - z*sqrt(p*(1-p)/an + z*z/(4*an*an))) / (1 + z*z/an)) AS af_lo,
                 least(1, (p + z*z/(2*an) + z*sqrt(p*(1-p)/an + z*z/(4*an*an))) / (1 + z*z/an)) AS af_hi,
                 {", ".join(f"af_{g}" for g in GROUPS)}
          FROM w
          ORDER BY CASE chrom WHEN 'X' THEN 23 ELSE CAST(chrom AS INTEGER) END, pos
        ) TO '{out}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 200000)
    """)
    rows = con.sql(f"SELECT count(*) FROM '{out}'").fetchone()[0]
    return ctx.built(version, out, date(2018, 10, 17), sites=rows, chipLoci=len(loci))
