"""Pack manifests and the signed index (ADR-0007)."""

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import pyarrow.parquet as pq

from .paths import DIST, PLUGINS
from .sign import sign

MANIFEST_SCHEMA = 1


@dataclass
class PackSpec:
    """Static metadata from plugins/pack-<id>/pack.json."""

    id: str
    meta: dict
    plugin_dir: Path

    @classmethod
    def load(cls, plugin_dir: Path) -> "PackSpec":
        meta = json.loads((plugin_dir / "pack.json").read_text())
        return cls(meta["id"], meta, plugin_dir)


def all_specs() -> list[PackSpec]:
    return [PackSpec.load(p) for p in sorted(PLUGINS.glob("pack-*")) if (p / "pack.json").exists()]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class BuiltPack:
    spec: PackSpec
    version: str
    source_date: str | None
    parquet: Path
    stats: dict = field(default_factory=dict)


def write_manifest(built: BuiltPack) -> Path:
    import locus_py

    parquet = built.parquet
    meta = pq.read_metadata(parquet)
    manifest = {
        "schema": MANIFEST_SCHEMA,
        **built.spec.meta,
        "version": built.version,
        "sourceDate": built.source_date,
        "locusVersion": locus_py.LOCUS_VERSION,
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "file": parquet.name,
        "rows": meta.num_rows,
        "columns": [meta.schema.column(i).name for i in range(meta.num_columns)],
        "size": parquet.stat().st_size,
        "sha256": sha256_file(parquet),
        "stats": built.stats,
    }
    out = parquet.parent / "manifest.json"
    out.write_text(json.dumps(manifest, indent=2) + "\n")
    return out


def refresh_manifests() -> None:
    """Re-read pack.json into every built manifest (metadata edits without a rebuild)."""
    specs = {s.id: s for s in all_specs()}
    for m_path in DIST.glob("*/*/manifest.json"):
        old = json.loads(m_path.read_text())
        spec = specs.get(old["id"])
        if not spec:
            continue
        built = BuiltPack(spec, old["version"], old.get("sourceDate"), m_path.parent / old["file"], old.get("stats", {}))
        write_manifest(built)


def pack_dir(pack_id: str, version: str) -> Path:
    d = DIST / pack_id / version
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_index(root: Path = DIST, private: Path | None = None, public: Path | None = None) -> Path:
    """List the newest version of every built pack and sign the index bytes."""
    packs = []
    for pack in sorted(p for p in root.iterdir() if p.is_dir()):
        versions = sorted(v for v in pack.iterdir() if (v / "manifest.json").exists())
        if not versions:
            continue
        latest = versions[-1]
        m = json.loads((latest / "manifest.json").read_text())
        m["path"] = f"{pack.name}/{latest.name}/{m['file']}"
        packs.append(m)
    index = {
        "schema": MANIFEST_SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "packs": packs,
    }
    data = (json.dumps(index, indent=2) + "\n").encode()
    (root / "index.json").write_bytes(data)
    keys = {"private": private, "public": public} if private and public else {}
    (root / "index.json.sig").write_text(sign(data, **keys) + "\n")
    return root / "index.json"
