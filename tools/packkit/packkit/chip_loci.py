"""Chip-loci manifest: which positions consumer chips probe.

Built from public-domain (CC0) 23andMe files published by Harvard PGP
participants. Only rsID, chromosome and position are read; genotype columns
are never parsed or stored, and the downloaded files are never written to
disk. The fallback `--loci-from FILE` reads positions from a local raw file
(e.g. your own); its output stays in the gitignored cache.
"""

import gzip
import io
import json
import random
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

import locus_py

from .download import USER_AGENT
from .paths import CACHE, PLUGINS

PGP_LISTING = "https://my.pgp-hms.org/public_genetic_data?data_type=23andMe"
PGP_BASE = "https://my.pgp-hms.org"
OUT = CACHE / "chip-loci.parquet"
FILES_PER_CHIP = 2
MAX_DOWNLOADS = 300


def _profile() -> dict:
    return json.loads((PLUGINS / "profile-23andme" / "profile.json").read_text())


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def _as_text(blob: bytes) -> str | None:
    if blob[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            names = [n for n in z.namelist() if not n.endswith("/")]
            if not names:
                return None
            blob = z.read(max(names, key=lambda n: z.getinfo(n).file_size))
    elif blob[:2] == b"\x1f\x8b":
        blob = gzip.decompress(blob)
    try:
        return blob.decode("utf-8", errors="replace")
    except Exception:
        return None


def read_positions(text: str, profile: dict) -> tuple[str | None, list[tuple[int, int, str]]]:
    """Return (chip id or reason, [(chrom code, pos, rsid)]). Genotype columns are skipped."""
    header = "\n".join(l for l in text[:65536].splitlines() if l.startswith("#"))
    det = profile["detect"]
    if not any(m in header for m in det["headerContains"]):
        return "not a 23andMe file", []
    if any(m in header for m in det["rejectMarkers"]) or not any(m in header for m in det["buildMarkers"]):
        return "not build 37", []
    cols = profile["columns"]
    loci = []
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        f = line.split("\t", 3)  # the genotype column (f[3]) is never read
        if len(f) < 3 or f[0] == "rsid":
            continue
        code = locus_py.chrom_code(f[cols["chrom"]])
        if code is None or not f[cols["pos"]].isdigit():
            continue
        loci.append((code, int(f[cols["pos"]]), f[cols["rsid"]]))
    chip = next(
        (v["id"] for v in profile["chipVersions"] if v["minRows"] <= len(loci) < v["maxRows"]),
        f"no chip has {len(loci)} rows",
    )
    return chip, loci


def _pgp_files() -> list[str]:
    html = _get(PGP_LISTING).decode("utf-8", errors="replace")
    return re.findall(r'href="(/user_file/download/\d+)"', html)


def build(loci_from: Path | None = None) -> Path:
    profile = _profile()
    per_chip: dict[str, list[list[tuple[int, int, str]]]] = {}
    if loci_from:
        text = _as_text(loci_from.read_bytes())
        chip, loci = read_positions(text or "", profile)
        if not loci:
            sys.exit(f"{loci_from} is not usable: {chip}")
        chip = chip if chip in {v["id"] for v in profile["chipVersions"]} else "local"
        per_chip.setdefault(chip, []).append(loci)
        print(f"  {loci_from.name}: {len(loci)} loci, chip {chip or 'unknown'} (local only)")
    else:
        links = _pgp_files()
        random.Random(37).shuffle(links)
        wanted = {v["id"] for v in profile["chipVersions"]}
        for n, link in enumerate(links[:MAX_DOWNLOADS]):
            if all(len(per_chip.get(c, [])) >= FILES_PER_CHIP for c in wanted):
                break
            try:
                text = _as_text(_get(PGP_BASE + link))
            except Exception as e:  # noqa: BLE001
                print(f"  {link}: skipped ({e})")
                continue
            chip, loci = read_positions(text or "", profile)
            del text
            if chip not in wanted or len(per_chip.get(chip, [])) >= FILES_PER_CHIP:
                print(f"  {link}: skipped ({chip if chip not in wanted else chip + ' already sampled'})")
                continue
            per_chip.setdefault(chip, []).append(loci)
            print(f"  {link}: {len(loci)} loci -> {chip}")

    merged: dict[tuple[int, int], dict] = {}
    for chip, files in per_chip.items():
        for loci in files:
            for code, pos, rsid in loci:
                row = merged.setdefault((code, pos), {"rsid": rsid, "chips": set()})
                row["chips"].add(chip)
                if not row["rsid"].startswith("rs") and rsid.startswith("rs"):
                    row["rsid"] = rsid
    keys = sorted(merged)
    table = pa.table(
        {
            "chrom": pa.array([k[0] for k in keys], pa.uint8()),
            "pos": pa.array([k[1] for k in keys], pa.uint32()),
            "rsid": pa.array([merged[k]["rsid"] for k in keys], pa.string()),
            "chips": pa.array([",".join(sorted(merged[k]["chips"])) for k in keys], pa.string()),
        }
    )
    pq.write_table(table, OUT, compression="zstd")
    summary = {c: len(f) for c, f in per_chip.items()}
    print(f"chip-loci: {len(keys)} loci from files per chip {summary} -> {OUT}")
    return OUT


def load() -> pa.Table:
    if not OUT.exists():
        sys.exit("No chip-loci manifest yet: run `packkit chip-loci` first")
    return pq.read_table(OUT)
