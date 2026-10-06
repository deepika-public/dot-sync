import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompatibilityError, launchArguments, launchFailure, leavesFolderUntouched, parsePlan, parseSession, previewArguments, readSession, resolveBinary, runningPid, roomName, serverUrl, reachableFromWeb, webLink } from "../../src/session";

const file = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ version: "0.6.0", pid: process.pid, root: "/r", ws_port: 4444, invite: "abc", ...over });

describe("daemon session file", () => {
  it("accepts a current daemon and newer ones", () => {
    expect(serverUrl(parseSession(file(), "/r"))).toBe("ws://127.0.0.1:4444");
    for (const version of ["0.6.1", "0.10.0", "1.0.0"]) expect(parseSession(file({ version }), "/r").version).toBe(version);
  });
  it("names the problem when the daemon is too old or unreadable", () => {
    for (const version of ["0.4.1", "0.5.2", undefined, "new"]) {
      expect(() => parseSession(file({ version }), "/r")).toThrow(CompatibilityError);
    }
  });
  it("refuses a daemon serving another folder and malformed files", () => {
    expect(() => parseSession(file(), "/other")).toThrow(/root mismatch/);
    for (const over of [{ ws_port: 0 }, { ws_port: "4444" }, { pid: 1.5 }, { invite: 1 }]) {
      expect(() => parseSession(file(over), "/r")).toThrow(/Malformed/);
    }
    expect(() => parseSession("not json", "/r")).toThrow();
  });
  it("can still name the process of a daemon it refuses to talk to", () => {
    const root = mkdtempSync(join(tmpdir(), "deepika-sync-session-"));
    try {
      expect(runningPid(root)).toBeUndefined();
      mkdirSync(join(root, ".collab"));
      const write = (over: Record<string, unknown>) => writeFileSync(join(root, ".collab/session.json"), file({ root, ...over }));
      // Left running across an update: too old to use, not too old to stop.
      write({ version: "0.5.2" });
      expect(() => readSession(root)).toThrow(CompatibilityError);
      expect(runningPid(root)).toBe(process.pid);
      write({ version: undefined, invite: undefined, ws_port: undefined });
      expect(runningPid(root)).toBe(process.pid);
      // Never a process that is not this folder's daemon.
      for (const over of [{ pid: 2 ** 22 + 12345 }, { pid: 1 }, { pid: "12" }, { root: "/elsewhere" }]) {
        write(over);
        expect(runningPid(root)).toBeUndefined();
      }
      writeFileSync(join(root, ".collab/session.json"), "not json");
      expect(runningPid(root)).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("treats a missing file or a dead daemon as no session", () => {
    const root = mkdtempSync(join(tmpdir(), "deepika-sync-session-"));
    try {
      expect(readSession(root)).toBeUndefined();
      mkdirSync(join(root, ".collab"));
      // A pid far above any real one: the file a killed daemon left behind.
      writeFileSync(join(root, ".collab/session.json"), file({ root, pid: 2 ** 22 + 12345 }));
      expect(readSession(root)).toBeUndefined();
      writeFileSync(join(root, ".collab/session.json"), file({ root }));
      expect(readSession(root)?.invite).toBe("abc");
      expect(runningPid(root)).toBe(process.pid);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("encodes each path segment of a room, never the separators", () => {
    expect(roomName("note.md")).toBe("note.md");
    expect(roomName("Équipe notes/plan #1?.md")).toBe("%C3%89quipe%20notes/plan%20%231%3F.md");
  });
  it("lets the system choose the port, so two vaults never collide", () => {
    expect(launchArguments("/r", undefined, false, false)).toEqual(["share", "/r", "--ws-port", "0"]);
    // Joining is only ever launched after the preview was accepted.
    expect(launchArguments("/r", "INV", true, false)).toEqual(["join", "INV", "--root", "/r", "--ws-port", "0", "--yes", "--relay"]);
  });
  it("ties the session to this window on request, and names a daemon too old for it", () => {
    expect(launchArguments("/r", undefined, false, true)).toEqual(["share", "/r", "--ws-port", "0", "--exit-with-parent"]);
    expect(launchArguments("/r", "INV", false, true).at(-1)).toBe("--exit-with-parent");
    expect(launchFailure("error: unexpected argument '--exit-with-parent' found\n\nUsage: deepika-sync share")).toMatch(/Incompatible deepika-sync daemon.*0\.6\.0 or later/);
    expect(launchFailure("  session_already_running\n")).toBe("session_already_running");
  });
});

describe("join preview", () => {
  const plan = { session_documents: 2, create: ["a.md"], conflict: [], update: [], rename: [{ from: "x.md", to: "y.md" }], delete: [], identical: 1, share: ["mine.md"] };
  it("asks the daemon without letting it write, and never with --yes", () => {
    expect(previewArguments("/r", "INV", false)).toEqual(["join", "INV", "--root", "/r", "--preview"]);
    expect(previewArguments("/r", "INV", true)).toEqual(["join", "INV", "--root", "/r", "--preview", "--relay"]);
  });
  it("reads a plan and tells whether the folder is left alone", () => {
    expect(parsePlan(JSON.stringify(plan))).toEqual(plan);
    expect(leavesFolderUntouched(plan)).toBe(false);
    expect(leavesFolderUntouched({ ...plan, create: [], rename: [] })).toBe(true);
  });
  it("refuses anything that is not a plan rather than showing a reassuring empty one", () => {
    for (const broken of [{}, { ...plan, delete: undefined }, { ...plan, create: [1] }, { ...plan, rename: [{ from: "x" }] }, { ...plan, identical: "1" }]) {
      expect(() => parsePlan(JSON.stringify(broken))).toThrow(/Unreadable/);
    }
    expect(() => parsePlan("Error: inviter_unreachable")).toThrow();
  });
});

describe("finding the daemon binary", () => {
  it("uses a binary unpacked next to the plugin, unless a path was set", () => {
    const folder = mkdtempSync(join(tmpdir(), "deepika-sync-plugin-folder-"));
    try {
      expect(resolveBinary("deepika-sync", folder)).toBe("deepika-sync"); // nothing there: leave it to the PATH
      writeFileSync(join(folder, "deepika-sync"), "");
      expect(resolveBinary("deepika-sync", folder)).toBe(join(folder, "deepika-sync"));
      expect(resolveBinary("", folder)).toBe(join(folder, "deepika-sync"));
      expect(resolveBinary("/opt/custom/deepika-sync", folder)).toBe("/opt/custom/deepika-sync");
      expect(resolveBinary("deepika-sync", undefined)).toBe("deepika-sync");
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
});

describe("web link", () => {
  const invitation = (addrs: unknown[]) =>
    Buffer.from(JSON.stringify({ version: 1, address: { id: "ab", addrs }, capability: "c" })).toString("base64url");
  const relayed = invitation([{ Relay: "https://euc1-1.relay.n0.iroh.link./" }, { Ip: "10.0.0.2:4000" }]);
  const direct = invitation([{ Ip: "10.0.0.2:4000" }]);

  it("puts the invitation after the #, whatever the trailing slashes", () => {
    for (const page of ["https://example.org", "https://example.org/", " https://example.org// "])
      expect(webLink(page, relayed)).toEqual({ url: `https://example.org/#${relayed}` });
    expect(webLink("https://example.org/sub/", relayed)).toEqual({ url: `https://example.org/sub/#${relayed}` });
  });
  it("offers no link a browser could not use", () => {
    expect(reachableFromWeb(relayed)).toBe(true);
    for (const invite of [direct, "not an invitation", ""]) {
      expect(reachableFromWeb(invite)).toBe(false);
      expect(webLink("https://example.org", invite)).toHaveProperty("unavailable");
    }
    expect(webLink("  ", relayed)).toHaveProperty("unavailable");
  });
});
