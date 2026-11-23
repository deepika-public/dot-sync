#!/usr/bin/env python3
"""Print the text of a release: its CHANGELOG.md section, then what only the release says.

    python3 scripts/release-notes.py                   # version of manifest.json
    python3 scripts/release-notes.py 0.8.0
    python3 scripts/release-notes.py 0.8.0 --github    # plus where the ZIP is

Fails when the version has no section, or an empty one: a release always says what
changed. Relative links become links to the files at that tag, so they work on the
GitLab and GitHub release pages. The footer gives the Obsidian version required (from
versions.json), the deepika-sync release the pipeline tested it against (when
DEEPIKA_SYNC_RELEASE_TAG is set), how to update, the full changelog and the diff from the
previous published version."""
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = "https://gitlab.com/deepika-public/deepika-obsidian-toolbox/dot-sync"
HEADING = re.compile(r"^## \[?(\d+\.\d+\.\d+)\]?(?:\s+-\s+.*)?$", re.M)


def section(text: str, version: str) -> str:
    """The body of `## [version] - date` (or `## version`), up to the next `## ` heading."""
    found = next((m for m in HEADING.finditer(text) if m.group(1) == version), None)
    if not found:
        raise SystemExit(f"CHANGELOG.md n'a pas de section pour {version}")
    rest = text[found.end():]
    end = re.search(r"^## |^\[[^\]]+\]: ", rest, re.M)
    body = (rest[: end.start()] if end else rest).strip()
    if not body:
        raise SystemExit(f"La section {version} de CHANGELOG.md est vide")
    return body


def previous_release(text: str, version: str) -> str | None:
    """The version listed just below, if it was released here (it has a `[x.y.z]:` link)."""
    versions = [m.group(1) for m in HEADING.finditer(text)]
    below = versions[versions.index(version) + 1:] if version in versions else []
    if below and re.search(rf"^\[{re.escape(below[0])}\]: ", text, re.M):
        return below[0]
    return None


def absolute_links(body: str, version: str) -> str:
    """`](docs/x.md#a)` → `](REPO/-/blob/version/docs/x.md#a)`; web links are kept."""
    return re.sub(r"\]\((?!https?://|#)([^)\s]+)\)", rf"]({REPO}/-/blob/{version}/\1)", body)


def footer(text: str, version: str, github: bool) -> str:
    minimum = json.loads((ROOT / "versions.json").read_text()).get(version)
    parts = [f"Requiert Obsidian {minimum} ou plus"] if minimum else []
    tested = os.environ.get("DEEPIKA_SYNC_RELEASE_TAG", "").strip()
    if tested:
        parts.append(f"Testé contre deepika-sync {tested}")
    parts.append(f"[Mettre à jour]({REPO}/-/blob/{version}/docs/how-to/install.md#mettre-à-jour)")
    parts.append(f"[Changelog complet]({REPO}/-/blob/main/CHANGELOG.md)")
    previous = previous_release(text, version)
    if previous:
        parts.append(f"[Changements depuis {previous}]({REPO}/-/compare/{previous}...{version})")
    lines = ["---", "", " · ".join(parts)]
    if github:
        lines += ["", f"ZIP et `SHA256SUMS` : [release GitLab]({REPO}/-/releases/{version})."]
    return "\n".join(lines)


def notes(version: str, github: bool = False) -> str:
    text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    return f"{absolute_links(section(text, version), version)}\n\n{footer(text, version, github)}\n"


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--github"]
    version = args[0] if args else json.loads((ROOT / "manifest.json").read_text())["version"]
    sys.stdout.write(notes(version, github="--github" in sys.argv[1:]))


if __name__ == "__main__":
    main()
