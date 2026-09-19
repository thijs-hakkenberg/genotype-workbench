"""PhyloTree 17 (rCRS orientation) as one row per haplogroup node.

Each node keeps the mutations on the branch leading to it, exactly as
PhyloTree writes them (e.g. "263G", "16519C!", "315.1C", "523d"), with their
HaploGrep phylogenetic weights. Interpreting them is the analysis plugin's job.
"""

import io
import xml.etree.ElementTree as ET
import zipfile
from datetime import date

import pyarrow as pa
import pyarrow.parquet as pq

URL = "https://github.com/genepi/phylotree-rcrs-17/releases/download/17.3/phylotree-rcrs-17.3.zip"


def build(ctx):
    with zipfile.ZipFile(ctx.fetch(URL)) as z:
        root = ET.fromstring(z.read("tree.xml"))
        weights = {}
        for line in io.StringIO(z.read("weights.txt").decode()):
            parts = line.split()
            if len(parts) >= 2:
                weights[parts[0]] = float(parts[1])

    rows = {k: [] for k in ("name", "parent", "depth", "polys", "weights")}

    def walk(el, parent, depth):
        for hg in el.findall("haplogroup"):
            name = hg.get("name")
            polys = [p.text.strip() for p in hg.findall("details/poly") if p.text and p.text.strip()]
            rows["name"].append(name)
            rows["parent"].append(parent)
            rows["depth"].append(depth)
            rows["polys"].append(polys)
            rows["weights"].append([weights.get(p.rstrip("!"), 1.0) for p in polys])
            walk(hg, name, depth + 1)

    walk(root, None, 0)
    table = pa.table({
        "name": pa.array(rows["name"], pa.string()),
        "parent": pa.array(rows["parent"], pa.string()),
        "depth": pa.array(rows["depth"], pa.int16()),
        "polys": pa.array(rows["polys"], pa.list_(pa.string())),
        "weights": pa.array(rows["weights"], pa.list_(pa.float32())),
    })
    version = "17.3"
    out = ctx.out_dir(version) / "haplotree-mt.parquet"
    pq.write_table(table, out, compression="zstd")
    return ctx.built(version, out, date(2016, 2, 18), nodes=len(table))
