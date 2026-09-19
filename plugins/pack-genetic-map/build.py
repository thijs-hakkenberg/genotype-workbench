"""HapMap II genetic map, interpolated to chip loci (cM per locus)."""

import io
import re
import tarfile
from datetime import date

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

URL = "https://ftp.ncbi.nlm.nih.gov/hapmap/recombination/2011-01_phaseII_B37/genetic_map_HapMapII_GRCh37.tar.gz"
CODE = {**{str(i): i for i in range(1, 23)}, "X": 23}


def build(ctx):
    maps: dict[int, np.ndarray] = {}
    with tarfile.open(ctx.fetch(URL)) as tar:
        for m in tar.getmembers():
            hit = re.search(r"chr(\w+)\.txt$", m.name)
            if not hit or hit.group(1) not in CODE:
                continue
            text = tar.extractfile(m).read().decode()
            rows = [l.split() for l in io.StringIO(text) if l and l[0].isalnum() and not l.startswith("Chrom")]
            maps[CODE[hit.group(1)]] = np.array([[float(r[1]), float(r[2]), float(r[3])] for r in rows])

    loci = ctx.chip_loci()
    chrom = loci.column("chrom").to_numpy()
    pos = loci.column("pos").to_numpy()
    out_chrom, out_pos, out_cm, out_rate = [], [], [], []
    for code, m in sorted(maps.items()):
        idx = np.nonzero(chrom == code)[0]
        p = pos[idx].astype(float)
        cm = np.interp(p, m[:, 0], m[:, 2])
        rate = np.interp(p, m[:, 0], m[:, 1])
        name = "X" if code == 23 else str(code)
        out_chrom += [name] * len(idx)
        out_pos += pos[idx].tolist()
        out_cm += cm.tolist()
        out_rate += rate.tolist()
    table = pa.table({
        "chrom": pa.array(out_chrom, pa.string()),
        "pos": pa.array(out_pos, pa.int32()),
        "cm": pa.array(out_cm, pa.float32()),
        "rate": pa.array(out_rate, pa.float32()),
    })
    version = "hapmap2-2011-01"
    out = ctx.out_dir(version) / "genetic-map.parquet"
    pq.write_table(table, out, compression="zstd")
    return ctx.built(version, out, date(2011, 1, 19), loci=len(table), chromosomes=len(maps))
