"""Mondo disease terms: name, definition, exact synonyms and cross-references."""

import re
from datetime import date

import pyarrow as pa
import pyarrow.parquet as pq

URL = "https://github.com/monarch-initiative/mondo/releases/latest/download/mondo.obo"
DEF = re.compile(r'^def: "((?:[^"\\]|\\.)*)"')
SYN = re.compile(r'^synonym: "((?:[^"\\]|\\.)*)" EXACT')


def build(ctx):
    obo = ctx.fetch(URL, refresh=True)
    cols = {k: [] for k in ("mondo_id", "name", "definition", "synonyms", "orphanet", "omim", "medgen")}
    term: dict | None = None
    version = None

    def flush():
        if term and term.get("id", "").startswith("MONDO:") and not term.get("obsolete"):
            cols["mondo_id"].append(term["id"])
            cols["name"].append(term.get("name"))
            cols["definition"].append(term.get("def"))
            cols["synonyms"].append(term.get("syn", []))
            xref = term.get("xref", [])
            cols["orphanet"].append([x.split(":", 1)[1] for x in xref if x.startswith("Orphanet:")])
            cols["omim"].append([x.split(":", 1)[1] for x in xref if x.startswith("OMIM:")])
            cols["medgen"].append([x.split(":", 1)[1] for x in xref if x.startswith(("UMLS:", "MEDGEN:", "MedGen:"))])

    with open(obo, encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n")
            if line.startswith("data-version:"):
                m = re.search(r"\d{4}-\d{2}-\d{2}", line)
                version = m.group(0) if m else None
            if line.startswith("["):
                flush()
                term = {} if line == "[Term]" else None
                continue
            if term is None or not line:
                continue
            key, _, value = line.partition(": ")
            if key == "id":
                term["id"] = value
            elif key == "name":
                term["name"] = value
            elif key == "def":
                m = DEF.match(line)
                term["def"] = m.group(1).replace('\\"', '"') if m else None
            elif key == "synonym":
                m = SYN.match(line)
                if m:
                    term.setdefault("syn", []).append(m.group(1))
            elif key == "xref":
                term.setdefault("xref", []).append(value.split(" ")[0])
            elif key == "is_obsolete" and value == "true":
                term["obsolete"] = True
    flush()

    table = pa.table({
        "mondo_id": pa.array(cols["mondo_id"], pa.string()),
        "name": pa.array(cols["name"], pa.string()),
        "definition": pa.array(cols["definition"], pa.string()),
        "synonyms": pa.array(cols["synonyms"], pa.list_(pa.string())),
        "orphanet": pa.array(cols["orphanet"], pa.list_(pa.string())),
        "omim": pa.array(cols["omim"], pa.list_(pa.string())),
        "medgen": pa.array(cols["medgen"], pa.list_(pa.string())),
    }).sort_by("mondo_id")
    source_date = ctx.last_modified(URL) or date.today()
    version = version or source_date.isoformat()
    out = ctx.out_dir(version) / "conditions-mondo.parquet"
    pq.write_table(table, out, compression="zstd")
    return ctx.built(version, out, source_date, terms=len(table))
