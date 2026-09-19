"""Download cache: every source file is fetched once into .cache/packs."""

import email.utils
import shutil
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

from .paths import CACHE

USER_AGENT = "genotype-workbench-packkit/0.1 (+https://github.com/thijs-hakkenberg/genotype-workbench)"


def _request(url: str, method: str = "GET", headers: dict | None = None):
    req = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT, **(headers or {})})
    return urllib.request.urlopen(req, timeout=120)


def last_modified(url: str) -> date | None:
    """Source release date from the Last-Modified header, used as pack version."""
    try:
        with _request(url, "HEAD") as r:
            lm = r.headers.get("Last-Modified")
    except Exception:
        return None
    if not lm:
        return None
    return email.utils.parsedate_to_datetime(lm).date()


def fetch(url: str, name: str | None = None, refresh: bool = False, attempts: int = 8) -> Path:
    """Download url into the cache and return its path.

    A short read (the server closing early) is resumed with a Range request;
    the file only leaves its .part name once its length matches the server's.
    """
    dest = CACHE / (name or url.rstrip("/").split("/")[-1].split("?")[0])
    if dest.exists() and not refresh:
        return dest
    part = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, attempts + 1):
        have = part.stat().st_size if part.exists() else 0
        headers = {"Range": f"bytes={have}-"} if have else {}
        try:
            with _request(url, headers=headers) as r:
                resumed = r.status == 206
                length = r.headers.get("Content-Length")
                total = int(length) + (have if resumed else 0) if length else None
                done = have if resumed else 0
                t0 = time.time()
                with open(part, "ab" if resumed else "wb") as f:
                    while chunk := r.read(1 << 20):
                        f.write(chunk)
                        done += len(chunk)
                        if time.time() - t0 > 2:
                            pct = f"{done / total:.0%}" if total else f"{done >> 20} MB"
                            print(f"\r  {dest.name}: {pct}", end="", file=sys.stderr)
                            t0 = time.time()
        except (OSError, urllib.error.URLError) as e:
            print(f"\n  {dest.name}: attempt {attempt} failed ({e}), resuming", file=sys.stderr)
            time.sleep(min(30, 2**attempt))
            continue
        if total is None or done == total:
            print(f"\r  {dest.name}: done ({done >> 20} MB)", file=sys.stderr)
            shutil.move(part, dest)
            return dest
        print(f"\n  {dest.name}: short read {done}/{total}, resuming", file=sys.stderr)
    raise RuntimeError(f"could not download {url} after {attempts} attempts")
