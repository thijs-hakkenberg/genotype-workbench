"""UniProt reviewed human proteins, keyed by the Ensembl transcripts that make them."""

import csv
import io
from datetime import date

import pyarrow as pa
import pyarrow.parquet as pq

URL = (
    "https://rest.uniprot.org/uniprotkb/stream?query=organism_id:9606+AND+reviewed:true"
    "&format=tsv&fields=accession,id,protein_name,gene_primary,length,sequence,xref_ensembl"
)


def build(ctx):
    tsv = ctx.fetch(URL, name="uniprot-human-reviewed.tsv", refresh=True)
    cols = {k: [] for k in ("accession", "entry_name", "name", "symbol", "length", "sequence", "transcripts")}
    with open(tsv, encoding="utf-8") as f:
        for r in csv.DictReader(io.StringIO(f.read()), delimiter="\t"):
            # "ENST00000264162.7 [P09848-1];ENST...;" -> transcript ids without version
            tx = sorted({t.split(".")[0] for part in (r.get("Ensembl") or "").split(";")
                         for t in [part.strip().split(" ")[0]] if t.startswith("ENST")})
            cols["accession"].append(r["Entry"])
            cols["entry_name"].append(r["Entry Name"])
            cols["name"].append((r.get("Protein names") or "").split(" (")[0])
            cols["symbol"].append(r.get("Gene Names (primary)") or None)
            cols["length"].append(int(r["Length"]) if r.get("Length", "").isdigit() else None)
            cols["sequence"].append(r.get("Sequence") or None)
            cols["transcripts"].append(tx)

    table = pa.table({
        "accession": pa.array(cols["accession"], pa.string()),
        "entry_name": pa.array(cols["entry_name"], pa.string()),
        "name": pa.array(cols["name"], pa.string()),
        "symbol": pa.array(cols["symbol"], pa.string()),
        "length": pa.array(cols["length"], pa.int32()),
        "sequence": pa.array(cols["sequence"], pa.string()),
        "transcripts": pa.array(cols["transcripts"], pa.list_(pa.string())),
    })
    version = date.today().isoformat()
    out = ctx.out_dir(version) / "proteins-uniprot.parquet"
    pq.write_table(table, out, compression="zstd")
    return ctx.built(version, out, date.today(), proteins=len(table),
                     withTranscript=sum(1 for t in cols["transcripts"] if t))
