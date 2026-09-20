"""packkit command line: build packs, the chip-loci manifest and the signed index."""

import argparse
import importlib.util
import sys
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import duckdb

from . import chip_loci, fixtures
from .download import fetch, last_modified
from .manifest import BuiltPack, PackSpec, all_specs, pack_dir, refresh_manifests, write_index, write_manifest
from .paths import CACHE, DIST

# Build order matters: later packs may read earlier ones (e.g. the reference).
ORDER = [
    "reference-grch37", "genes-gencode", "sequence-grch37", "proteins-uniprot", "clinvar", "gwas-catalog", "conditions-mondo", "freq-1000g",
    "dbsnp-merges", "genetic-map", "haplotree-mt", "haplotree-y", "gnomad-chip",
]


@dataclass
class BuildContext:
    spec: PackSpec
    cache: Path = CACHE
    dist: Path = DIST

    fetch = staticmethod(fetch)
    last_modified = staticmethod(last_modified)

    def chip_loci(self):
        return chip_loci.load()

    def out_dir(self, version: str) -> Path:
        return pack_dir(self.spec.id, version)

    def duckdb(self) -> duckdb.DuckDBPyConnection:
        return duckdb.connect()

    def built(self, version: str, parquet: Path, source_date: date | None, **stats) -> BuiltPack:
        return BuiltPack(self.spec, version, source_date.isoformat() if source_date else None, parquet, stats)

    def latest(self, pack_id: str) -> Path:
        """Parquet file of the newest built version of another pack."""
        versions = sorted((DIST / pack_id).glob("*/manifest.json"))
        if not versions:
            sys.exit(f"{self.spec.id} needs {pack_id}; build it first")
        d = versions[-1].parent
        return next(d.glob("*.parquet"))


def _load_builder(spec: PackSpec):
    path = spec.plugin_dir / "build.py"
    mod_spec = importlib.util.spec_from_file_location(f"packbuild_{spec.id.replace('-', '_')}", path)
    mod = importlib.util.module_from_spec(mod_spec)
    mod_spec.loader.exec_module(mod)
    return mod.build


def cmd_build(args) -> None:
    specs = {s.id: s for s in all_specs()}
    ids = args.only or [i for i in ORDER if i in specs and i not in (args.skip or [])]
    for pack_id in ids:
        spec = specs.get(pack_id) or sys.exit(f"unknown pack '{pack_id}'")
        print(f"== {pack_id}")
        t0 = time.time()
        built = _load_builder(spec)(BuildContext(spec))
        manifest = write_manifest(built)
        print(f"   {built.parquet.stat().st_size / 1e6:.1f} MB, {time.time() - t0:.0f}s -> {manifest}")
    index = write_index()
    print(f"index: {index} (signed)")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="packkit")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="build packs into packs-dist/")
    b.add_argument("--only", nargs="+", help="pack ids to build")
    b.add_argument("--skip", nargs="+", help="pack ids to skip")
    b.set_defaults(fn=cmd_build)

    c = sub.add_parser("chip-loci", help="build the chip-loci manifest (positions only)")
    c.add_argument("--loci-from", type=Path, help="local raw file to read positions from instead of PGP")
    c.set_defaults(fn=lambda a: chip_loci.build(a.loci_from))

    i = sub.add_parser("index", help="rewrite and re-sign packs-dist/index.json")
    i.set_defaults(fn=lambda a: print(write_index()))

    f = sub.add_parser("fixtures", help="cut small signed fixture packs for tests into fixtures/packs")
    f.set_defaults(fn=lambda a: print(fixtures.build()))

    r = sub.add_parser("remanifest", help="rewrite manifests from pack.json without rebuilding data")
    r.set_defaults(fn=lambda a: (refresh_manifests(), print(write_index())))

    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
