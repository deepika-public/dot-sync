// @vitest-environment jsdom
// Real CodeMirror editors bound through one real daemon. Needs DEEPIKA_SYNC_BINARY.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, execFileSync, ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, renameSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import NodeWebSocket from "ws";
import { Binding, collab, remoteOutOfHistory } from "../../src/binding";
import { MINIMUM_DAEMON, parsePlan, previewArguments, readSession, serverUrl, Session } from "../../src/session";

const binary = process.env.DEEPIKA_SYNC_BINARY;
// jsdom's WebSocket sends a browser Origin, which the daemon rightly refuses.
(globalThis as any).WebSocket = NodeWebSocket;

// jsdom has no layout: give CodeMirror's measuring pass empty rectangles.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(check: () => T | undefined | false, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error("Timed out: " + check);
    await sleep(25);
  }
}

describe.skipIf(!binary)("binding against a real daemon", () => {
  let root: string, daemon: ChildProcess, session: Session;
  const bindings: Binding[] = [];
  const warnings: string[] = [];
  const moves: string[] = [];
  const disk = (path: string) => readFileSync(join(root, path), "utf8");

  function editor(path: string, name: string, text: string) {
    const view = new EditorView({
      state: EditorState.create({ doc: text, extensions: [history(), collab.of([]), remoteOutOfHistory,
        EditorView.updateListener.of((u) => binding.update(u))] }),
      parent: document.body,
    });
    const binding: Binding = new Binding(view, path, serverUrl(session), name, {
      warn: (t) => warnings.push(t),
      moved: (_b, to) => moves.push(to),
      superseded: () => warnings.push("superseded"),
    });
    bindings.push(binding);
    return { view, binding, text: () => view.state.doc.toString() };
  }

  beforeAll(async () => {
    // An older daemon never writes the session file: say so instead of timing out.
    const version = execFileSync(binary!, ["--version"], { encoding: "utf8" }).trim().split(" ").pop()!;
    const tooOld = MINIMUM_DAEMON.join(".").localeCompare(version, undefined, { numeric: true }) > 0;
    if (tooOld) throw new Error(`DEEPIKA_SYNC_BINARY is ${version}; this plugin requires daemon ${MINIMUM_DAEMON.join(".")} or later`);
    root = realpathSync(mkdtempSync(join(tmpdir(), "deepika-sync-plugin-")));
    writeFileSync(join(root, "note.md"), "Bonjour été 😀\n");
    daemon = spawn(binary!, ["share", root, "--ws-port", "0"], { stdio: "ignore" });
    session = await until(() => readSession(root));
  });
  afterAll(async () => {
    for (const b of bindings) b.destroy();
    daemon?.kill("SIGTERM");
    await sleep(300);
    rmSync(root, { recursive: true, force: true });
  });

  it("describes itself in a session file", () => {
    expect(session.root).toBe(root);
    expect(session.invite.length).toBeGreaterThan(20);
  });

  it("previews a join without writing anything in the joining folder", () => {
    const joiner = realpathSync(mkdtempSync(join(tmpdir(), "deepika-sync-joiner-")));
    try {
      writeFileSync(join(joiner, "note.md"), "a different text\n");
      writeFileSync(join(joiner, "mine.md"), "only here\n");
      const plan = parsePlan(execFileSync(binary!, previewArguments(joiner, session.invite, false), { encoding: "utf8" }));
      expect(plan).toMatchObject({ session_documents: 1, create: [], conflict: ["note.md"], share: ["mine.md"] });
      expect(readdirSync(joiner).sort()).toEqual(["mine.md", "note.md"]);
    } finally { rmSync(joiner, { recursive: true, force: true }); }
  });

  it("merges typing from two editors, relays presence, and writes the file when both close", async () => {
    const alice = editor("note.md", "Alice", "Bonjour été 😀\n");
    const bob = editor("note.md", "Bob", "Bonjour été 😀\n");
    await until(() => alice.binding.bound && bob.binding.bound);

    alice.view.dispatch({ changes: { from: 0, insert: "Alice: " } });
    bob.view.dispatch({ changes: { from: bob.text().length, insert: "Bob 🎉\n" } });
    const merged = await until(() => alice.text() === bob.text() && alice.text().includes("Bob 🎉") && alice.text());
    expect(merged).toBe("Alice: Bonjour été 😀\nBob 🎉\n");

    // Presence travels through the daemon's awareness relay.
    await until(() => [...bob.binding.provider.awareness.getStates().values()].some((s: any) => s.user?.name === "Alice"));

    // Undo only undoes one's own typing.
    undo(bob.view);
    await until(() => alice.text() === "Alice: Bonjour été 😀\n" && bob.text() === alice.text());

    // While a note is open the daemon leaves the file alone; closing releases it.
    expect(disk("note.md")).toBe("Bonjour été 😀\n");
    alice.binding.destroy();
    bob.binding.destroy();
    await until(() => disk("note.md") === "Alice: Bonjour été 😀\n");
    expect(warnings).toEqual([]);
  });

  it("aligns an editor that opens on stale text, keeping what was typed before the sync", async () => {
    const late = editor("note.md", "Late", "Bonjour été 😀\n");
    late.view.dispatch({ changes: { from: late.text().length, insert: "typed early\n" } });
    await until(() => late.binding.bound);
    expect(late.text()).toBe("Alice: Bonjour été 😀\ntyped early\n");
    late.binding.destroy();
    await until(() => disk("note.md") === "Alice: Bonjour été 😀\ntyped early\n");
  });

  it("creates a note that only exists in the editor, in a folder with spaces and accents", async () => {
    const fresh = editor("Équipe notes/nouvelle note.md", "Alice", "");
    await until(() => fresh.binding.bound);
    fresh.view.dispatch({ changes: { from: 0, insert: "contenu" } });
    fresh.binding.destroy();
    await until(() => existsSync(join(root, "Équipe notes/nouvelle note.md")) && disk("Équipe notes/nouvelle note.md") === "contenu");
  });

  it("reports a rename made while the note is open, and reconnects under the new path", async () => {
    const open = editor("note.md", "Alice", disk("note.md"));
    await until(() => open.binding.bound);
    renameSync(join(root, "note.md"), join(root, "renamed.md"));
    await until(() => moves.includes("renamed.md")).catch((e) => { throw new Error("no move seen: " + JSON.stringify({ moves, meta: open.binding.metadata.toJSON() })); });
    open.binding.setPath("renamed.md");
    expect(open.binding.provider.url.endsWith("/renamed.md")).toBe(true);
    open.view.dispatch({ changes: { from: 0, insert: "after rename\n" } });
    open.binding.destroy();
    await until(() => disk("renamed.md").startsWith("after rename\n"));
    expect(existsSync(join(root, "note.md"))).toBe(false);
  });
});
