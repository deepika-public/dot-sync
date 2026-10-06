// Finding and starting the daemon. A running daemon describes itself in
// `<root>/.collab/session.json`, so the plugin attaches the same way to a daemon it
// launched and to one started from a terminal.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type Session = {
  version: string;
  pid: number;
  root: string;
  ws_port: number;
  invite: string;
};

/** First daemon version serving the y-sync WebSocket and `session.json`. */
export const MINIMUM_DAEMON = [0, 6, 0] as const;

export class CompatibilityError extends Error {
  constructor(detail: string) {
    super(`Incompatible deepika-sync daemon: ${detail}. Daemon ${MINIMUM_DAEMON.join(".")} or later is required. Update the daemon; local notes are untouched.`);
    this.name = "CompatibilityError";
  }
}

/** A JSON object, as read from a file or a command written by the daemon. */
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function parseSession(raw: string, root: string): Session {
  const s: unknown = JSON.parse(raw);
  if (!isRecord(s) || typeof s.version !== "string") throw new CompatibilityError("session file has no version");
  const version = s.version.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (!Number.isInteger(version[i])) throw new CompatibilityError(`unreadable version ${s.version}`);
    if (version[i] !== MINIMUM_DAEMON[i]) {
      if (version[i] < MINIMUM_DAEMON[i]) throw new CompatibilityError(`found version ${s.version}`);
      break;
    }
  }
  const port = s.ws_port;
  if (!Number.isInteger(s.pid) || typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535 ||
      typeof s.invite !== "string") {
    throw new Error("Malformed daemon session file");
  }
  if (s.root !== root) throw new Error("Daemon shared root mismatch");
  return s as Session;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The daemon serving `root`, if one is running. A daemon that was killed leaves its
 *  file behind: a dead pid means no session. */
/** The process announcing itself in this folder, whatever its version: stopping a daemon
 *  must never depend on being able to talk to it. */
export function runningPid(root: string): number | undefined {
  try {
    const s: unknown = JSON.parse(readFileSync(join(root, ".collab/session.json"), "utf8"));
    if (!isRecord(s) || typeof s.pid !== "number") return undefined;
    return Number.isInteger(s.pid) && s.pid > 1 && s.root === root && isAlive(s.pid) ? s.pid : undefined;
  } catch {
    return undefined;
  }
}
export function readSession(root: string): Session | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(root, ".collab/session.json"), "utf8");
  } catch {
    return undefined;
  }
  const session = parseSession(raw, root);
  return isAlive(session.pid) ? session : undefined;
}

export const serverUrl = (session: Session) => `ws://127.0.0.1:${session.ws_port}`;

/** The WebSocket room of a note: its path inside the shared root, segment-encoded. */
export const roomName = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export function launchArguments(root: string, invite: string | undefined, relay: boolean, stopWithParent: boolean): string[] {
  // Port 0: the system picks a free port, so two vaults never fight over one.
  // `--yes`: the plugin has already shown the join preview and the user accepted it.
  const args = invite
    ? ["join", invite, "--root", root, "--ws-port", "0", "--yes"]
    : ["share", root, "--ws-port", "0"];
  if (relay) args.push("--relay");
  // The daemon stops when the pipe to its standard input closes, that is when Obsidian
  // goes away, however it does: quit, crash or kill.
  if (stopWithParent) args.push("--exit-with-parent");
  return args;
}

/** What a daemon too old for an option of ours prints when refusing to start. */
export function launchFailure(stderr: string): string {
  return /unexpected argument '--exit-with-parent'/.test(stderr)
    ? new CompatibilityError("it does not know --exit-with-parent").message
    : stderr.trim();
}

/** What joining would change in the folder, as `deepika-sync join --preview` reports it. */
export type JoinPlan = {
  session_documents: number;
  create: string[];
  conflict: string[];
  update: string[];
  rename: { from: string; to: string }[];
  delete: string[];
  identical: number;
  share: string[];
};

/** Asks the daemon binary for the plan. It writes nothing in the folder. */
export function previewArguments(root: string, invite: string, relay: boolean): string[] {
  const args = ["join", invite, "--root", root, "--preview"];
  if (relay) args.push("--relay");
  return args;
}

export function parsePlan(raw: string): JoinPlan {
  const plan: unknown = JSON.parse(raw);
  const paths = (value: unknown) => Array.isArray(value) && value.every((p) => typeof p === "string");
  const renames = (value: unknown) =>
    Array.isArray(value) && value.every((r) => isRecord(r) && typeof r.from === "string" && typeof r.to === "string");
  if (!isRecord(plan) || !Number.isInteger(plan.session_documents) || !Number.isInteger(plan.identical) ||
      !["create", "conflict", "update", "delete", "share"].every((key) => paths(plan[key])) || !renames(plan.rename)) {
    throw new Error("Unreadable join preview from the daemon");
  }
  return plan as JoinPlan;
}

/** True when joining leaves every file of the folder as it is. */
export const leavesFolderUntouched = (plan: JoinPlan) =>
  !plan.create.length && !plan.conflict.length && !plan.update.length && !plan.rename.length && !plan.delete.length;

/** The daemon to run. A binary dropped next to the plugin is found without any setting:
 *  download the release, unpack it into the plugin folder, done. An explicit setting
 *  always wins; otherwise the name is left to the PATH. */
export function resolveBinary(configured: string, pluginFolder: string | undefined): string {
  const chosen = configured.trim();
  if (chosen && chosen !== "deepika-sync") return chosen;
  if (pluginFolder) {
    const bundled = join(pluginFolder, "deepika-sync");
    try { if (statSync(bundled).isFile()) return bundled; } catch { /* not there */ }
  }
  return "deepika-sync";
}

/** The published browser client; a link to it carries the invitation after `#`, which
 *  browsers never send to the server. */
export const WEB_PAGE = "https://deepika-public.gitlab.io/deepika-obsidian-toolbox/deepika-sync";

/** Whether an invitation names a relay. A browser cannot send UDP: it reaches the host
 *  through the relay or not at all. */
export function reachableFromWeb(invite: string): boolean {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(invite, "base64url").toString("utf8"));
    const address = isRecord(decoded) ? decoded.address : undefined;
    return isRecord(address) && Array.isArray(address.addrs) && address.addrs.some((a: unknown) => isRecord(a) && "Relay" in a);
  } catch { return false; }
}

/** The link a collaborator opens to join from a browser, or why there is none. */
export function webLink(page: string, invite: string): { url: string } | { unavailable: string } {
  const base = page.trim().replace(/\/+$/, "");
  if (!base) return { unavailable: "No web page is configured in the dot-sync settings." };
  if (!reachableFromWeb(invite)) return { unavailable: "A browser can only join through the relay: enable “Use public Iroh relay”, leave the session and start it again." };
  return { url: `${base}/#${invite}` };
}
