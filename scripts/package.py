#!/usr/bin/env python3
"""Package the already built plugin using the standard ZIP format; no upload."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
pkg = json.loads((ROOT / "package.json").read_text())
manifest = json.loads((ROOT / "manifest.json").read_text())
lock = json.loads((ROOT / "package-lock.json").read_text())
version = pkg["version"]
if version != manifest["version"] or version != lock["version"] or version != lock["packages"][""]["version"]:
    raise SystemExit("Package, lockfile and manifest versions must agree")
if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
    raise SystemExit("Packaging requires a stable X.Y.Z version")
tag = version  # Obsidian exige un tag égal à la version, sans « v »
if os.environ.get("CI_COMMIT_TAG") and os.environ["CI_COMMIT_TAG"] != tag:
    raise SystemExit("Git tag must match the plugin version")
commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
info = {"component": "dot-sync", "version": version, "commit": commit,
        "dirty": bool(subprocess.check_output(["git", "status", "--porcelain"])),
        "minimum_daemon": "0.5.0", "editor_protocol": "y-sync over WebSocket"}
if os.environ.get("CI_COMMIT_TAG") and info["dirty"]:
    raise SystemExit("Refusing to package a modified release checkout")
epoch = int(os.environ.get("SOURCE_DATE_EPOCH") or subprocess.check_output(["git", "show", "-s", "--format=%ct", "HEAD"], text=True))
date = time.gmtime(max(epoch, 315532800))[:6]
files = [ROOT / name for name in ["main.js", "manifest.json", "styles.css", "README.md"]]
files += sorted((ROOT / "docs").rglob("*.md"))
out = ROOT / "dist"
out.mkdir(exist_ok=True)
archive = out / f"dot-sync-{tag}.zip"
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
    entries = [(str(p.relative_to(ROOT)), p.read_bytes()) for p in files]
    entries.append(("BUILD.json", (json.dumps(info, indent=2) + "\n").encode()))
    for name, data in entries:
        entry = zipfile.ZipInfo(f"{manifest['id']}/{name}", date_time=date)
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        zipped.writestr(entry, data)
(out / "SHA256SUMS").write_text(f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}\n")
print(archive)
