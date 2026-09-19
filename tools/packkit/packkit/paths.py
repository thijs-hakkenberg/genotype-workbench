from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CACHE = REPO / ".cache" / "packs"
DIST = REPO / "packs-dist"
PLUGINS = REPO / "plugins"
KEYS = REPO / "keys"

for d in (CACHE, DIST):
    d.mkdir(parents=True, exist_ok=True)
