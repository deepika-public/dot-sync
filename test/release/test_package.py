"""Release packaging gates, on a throwaway Git copy of the plugin; no upload, no GitLab."""
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SOURCES = [".gitignore", "package.json", "package-lock.json", "manifest.json", "versions.json", "main.js",
           "styles.css", "README.md", "CHANGELOG.md", "docs", "scripts/package.py", "scripts/release-notes.py",
           "src/session.ts"]
VERSION = json.loads((ROOT / "manifest.json").read_text())["version"]
ARCHIVE = f"dot-sync-{VERSION}.zip"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class Packaging(unittest.TestCase):
    def setUp(self):
        if not (ROOT / "main.js").exists():
            self.skipTest("main.js is missing: run npm run build first")
        self.dir = Path(tempfile.mkdtemp(prefix="sync-package-"))
        self.addCleanup(shutil.rmtree, self.dir)
        for name in SOURCES:
            source, target = ROOT / name, self.dir / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                shutil.copytree(source, target)
            else:
                shutil.copy2(source, target)
        git(self.dir, "init", "-q")
        git(self.dir, "add", ".")
        git(self.dir, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "release")

    def package(self, **env):
        clean = {k: v for k, v in os.environ.items() if k not in ("CI_COMMIT_TAG", "SOURCE_DATE_EPOCH", "DEEPIKA_SYNC_RELEASE_TAG")}
        return subprocess.run(["python3", "scripts/package.py"], cwd=self.dir, env={**clean, **env},
                              capture_output=True, text=True)

    def test_archive_holds_the_plugin_its_docs_and_build_info(self):
        result = self.package()
        self.assertEqual(result.returncode, 0, result.stderr)
        dist = self.dir / "dist"
        line = (dist / "SHA256SUMS").read_text()
        self.assertEqual(line, f"{hashlib.sha256((dist / ARCHIVE).read_bytes()).hexdigest()}  {ARCHIVE}\n")
        with zipfile.ZipFile(dist / ARCHIVE) as zipped:
            names = set(zipped.namelist())
            info = json.loads(zipped.read("dot-sync/BUILD.json"))
            manifest = json.loads(zipped.read("dot-sync/manifest.json"))
        docs = {f"dot-sync/{p.relative_to(self.dir)}" for p in (self.dir / "docs").rglob("*.md")}
        expected = {f"dot-sync/{n}" for n in ["main.js", "manifest.json", "styles.css", "README.md", "CHANGELOG.md",
                                                 "BUILD.json"]}
        self.assertEqual(names, expected | docs)
        self.assertTrue(docs, "the documentation is shipped")
        self.assertEqual(manifest["id"], "dot-sync")
        self.assertEqual(info["version"], VERSION)
        self.assertEqual(info["commit"], git(self.dir, "rev-parse", "HEAD"))
        self.assertFalse(info["dirty"])
        minimum = re.search(r"MINIMUM_DAEMON = \[(\d+), (\d+), (\d+)\]", (ROOT / "src/session.ts").read_text())
        self.assertEqual(info["minimum_daemon"], ".".join(minimum.groups()))

    def test_same_commit_gives_the_same_bytes(self):
        self.assertEqual(self.package().returncode, 0)
        first = (self.dir / "dist" / ARCHIVE).read_bytes()
        (self.dir / "dist" / ARCHIVE).unlink()
        self.assertEqual(self.package().returncode, 0)
        self.assertEqual((self.dir / "dist" / ARCHIVE).read_bytes(), first)

    def test_a_tag_must_name_the_version(self):
        result = self.package(CI_COMMIT_TAG="99.0.0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Git tag must match", result.stderr)
        self.assertEqual(self.package(CI_COMMIT_TAG=VERSION).returncode, 0)

    def test_a_release_is_never_packaged_from_a_modified_checkout(self):
        with open(self.dir / "styles.css", "a") as f:
            f.write("/* local change */\n")
        result = self.package(CI_COMMIT_TAG=VERSION)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Refusing to package a modified release checkout", result.stderr)
        # Outside a release the archive is built, and says it is dirty.
        self.assertEqual(self.package().returncode, 0)
        with zipfile.ZipFile(self.dir / "dist" / ARCHIVE) as zipped:
            self.assertTrue(json.loads(zipped.read("dot-sync/BUILD.json"))["dirty"])

    def test_the_release_text_is_the_changelog_section_of_the_version(self):
        self.assertEqual(self.package().returncode, 0)
        notes = (self.dir / "dist" / "RELEASE_NOTES.md").read_text(encoding="utf-8")
        self.assertTrue(notes.strip())
        self.assertNotIn(f"## [{VERSION}]", notes, "the heading is the release's title, not its text")
        self.assertNotRegex(notes, r"^## ", "only this version's section")
        self.assertNotRegex(notes, r"\]\((?!https?://)", "relative links would break on the release page")
        minimum = json.loads((ROOT / "versions.json").read_text())[VERSION]
        self.assertIn(f"Requiert Obsidian {minimum}", notes)
        self.assertIn("CHANGELOG.md)", notes)
        self.assertNotIn("SHA256SUMS", notes, "on GitLab the files are on the page itself")
        self.assertNotIn("Testé contre", notes, "no tested daemon is claimed unless the pipeline names one")

    def test_the_release_text_names_the_daemon_it_was_tested_against(self):
        self.assertEqual(self.package(DEEPIKA_SYNC_RELEASE_TAG="v9.9.9").returncode, 0)
        self.assertIn("Testé contre deepika-sync v9.9.9", (self.dir / "dist" / "RELEASE_NOTES.md").read_text(encoding="utf-8"))

    def test_a_version_without_a_changelog_section_is_not_packaged(self):
        changelog = self.dir / "CHANGELOG.md"
        changelog.write_text(changelog.read_text(encoding="utf-8").replace(f"## [{VERSION}]", "## [99.0.0]"),
                             encoding="utf-8")
        result = self.package()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(f"pas de section pour {VERSION}", result.stderr)

    def test_versions_must_agree(self):
        manifest = json.loads((self.dir / "manifest.json").read_text())
        manifest["version"] = "99.0.0"
        (self.dir / "manifest.json").write_text(json.dumps(manifest))
        result = self.package()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("versions must agree", result.stderr)


if __name__ == "__main__":
    unittest.main()
