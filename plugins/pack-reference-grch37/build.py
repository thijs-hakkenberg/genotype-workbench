"""GRCh37 reference base at every chip locus, from hs37d5 (rCRS mitochondrion)."""

import gzip
import shutil
from datetime import date

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from pyfaidx import Fasta

URL = "https://ftp.1000genomes.ebi.ac.uk/vol1/ftp/technical/reference/phase2_reference_assembly_sequence/hs37d5.fa.gz"
NAMES = {**{i: str(i) for i in range(1, 23)}, 23: "X", 24: "Y", 25: "MT"}


def build(ctx):
    loci = ctx.chip_loci()
    fa = ctx.cache / "hs37d5.fa"
    if not fa.exists():
        gz = ctx.fetch(URL)
        with gzip.open(gz, "rb") as src, open(fa.with_suffix(".fa.part"), "wb") as dst:
            shutil.copyfileobj(src, dst, 1 << 24)
        fa.with_suffix(".fa.part").rename(fa)
    genome = Fasta(str(fa), as_raw=True, sequence_always_upper=True, rebuild=False)

    chrom = loci.column("chrom").to_numpy()
    pos = loci.column("pos").to_numpy()
    bases = bytearray(len(pos))
    for code, name in NAMES.items():
        idx = (chrom == code).nonzero()[0]
        if len(idx) == 0:
            continue
        seq = genome[name][:]  # one chromosome in memory, then index it
        for i in idx:
            p = int(pos[i])
            bases[i] = ord(seq[p - 1]) if p <= len(seq) else ord("N")
    ref = pa.array(list(bytes(bases).decode("ascii")), pa.string())
    table = pa.table({"chrom": loci.column("chrom"), "pos": loci.column("pos"), "ref": ref})
    keep = pc.is_in(table.column("ref"), pa.array(["A", "C", "G", "T"]))
    dropped = len(table) - pc.sum(keep).as_py()
    table = table.filter(keep)

    version = date.today().isoformat()
    out = ctx.out_dir(version) / "reference-grch37.parquet"
    pq.write_table(table, out, compression="zstd", row_group_size=256_000)
    return ctx.built(version, out, None, loci=len(loci), nonACGTDropped=int(dropped))
