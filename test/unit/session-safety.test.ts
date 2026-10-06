import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderRoot, sharedPath } from "../../src/session-safety";

describe("session folder safety", () => {
  it("accepts vault folders and rejects traversal, hidden folders and symlink escape", () => {
    const base = mkdtempSync(join(tmpdir(), "deepika-sync-folders-"));
    try {
      const vault = join(base, "vault");
      mkdirSync(vault);
      mkdirSync(join(vault, "Équipe notes"));
      mkdirSync(join(vault, ".private"));
      symlinkSync(base, join(vault, "outside"));
      expect(folderRoot(vault, "/")).toBe(realpathSync(vault));
      expect(folderRoot(vault, "Équipe notes")).toBe(realpathSync(join(vault, "Équipe notes")));
      for (const path of ["..", base, ".private", "outside", "missing"]) {
        expect(() => folderRoot(vault, path)).toThrow();
      }
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
  it("shares only visible Markdown notes inside the root", () => {
    const share = (path: string) => sharedPath("/vault/docs", "/vault", path);
    expect(share("docs/note.md")).toBe("note.md");
    expect(share("docs/Équipe notes/plan 😀.md")).toBe("Équipe notes/plan 😀.md");
    for (const path of ["other/note.md", "docs", "docs/image.png", "docs/.obsidian/x.md",
      "docs/.collab/session.json", "docs/../secret.md", "/etc/passwd.md"]) {
      expect(share(path), path).toBeUndefined();
    }
    // The whole vault as root.
    expect(sharedPath("/vault", "/vault", "note.md")).toBe("note.md");
  });
});
