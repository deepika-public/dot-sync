// Installing the daemon, on the user's request, from its GitHub release: the archive of
// this system, checked against the release's SHA256SUMS, unpacked into the plugin folder
// where `resolveBinary` finds it. No network access happens without that click.
import { createHash } from "node:crypto";
import { chmod, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

/** The daemon release the install button fetches. */
export const DAEMON_RELEASE = "0.6.1";
export const RELEASES = "https://github.com/deepika-public/deepika-sync/releases";
/** Name of the installed daemon in the plugin folder. */
export const DAEMON_FILE = "deepika-sync";

/** The release archives, by Node's platform and architecture, and how to name them. */
const TARGETS: Record<string, { target: string; label: string }> = {
  "linux-x64": { target: "x86_64-unknown-linux-musl", label: "Linux x86_64" },
  "linux-arm64": { target: "aarch64-unknown-linux-musl", label: "Linux arm64" },
  "darwin-arm64": { target: "aarch64-apple-darwin", label: "macOS (Apple Silicon)" },
  "darwin-x64": { target: "x86_64-apple-darwin", label: "macOS (Intel)" },
};

/** The daemon build for this system, or none: Windows is not supported yet. */
export function daemonTarget(platform: string, arch: string): { target: string; label: string } | undefined {
  return TARGETS[`${platform}-${arch}`];
}

export const archiveName = (version: string, target: string) => `deepika-sync-v${version}-${target}.tar.gz`;
export const downloadUrl = (version: string, file: string) => `${RELEASES}/download/v${version}/${file}`;

/** The checksum SHA256SUMS gives for `file`: exactly one line must name it. */
export function expectedChecksum(sums: string, file: string): string {
  const lines = sums.split("\n").map((line) => line.trim().split(/\s+\*?/)).filter((fields) => fields[1] === file);
  if (lines.length !== 1 || !/^[0-9a-f]{64}$/.test(lines[0][0])) throw new Error(`SHA256SUMS has no single checksum for ${file}`);
  return lines[0][0];
}

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The daemon executable inside a release archive (`<name>/deepika-sync`, tar + gzip).
 *  Reads ustar headers and PAX paths; anything else is ignored. */
export function extractDaemon(archive: Uint8Array): Uint8Array {
  const tar = gunzipSync(archive);
  const text = (from: number, length: number) => tar.subarray(from, from + length).toString("utf8").replace(/\0.*$/s, "");
  const found: Uint8Array[] = [];
  let paxPath: string | undefined;
  for (let at = 0; at + 512 <= tar.length;) {
    const header = tar.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = parseInt(text(at + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156]);
    const prefix = text(at + 257, 6).startsWith("ustar") ? text(at + 345, 155) : "";
    const body = tar.subarray(at + 512, at + 512 + size);
    if (!Number.isInteger(size) || size < 0 || body.length !== size) throw new Error("Truncated daemon archive");
    if (type === "x") {
      paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8"))?.[1];
    } else {
      const name = paxPath ?? (prefix ? `${prefix}/${text(at, 100)}` : text(at, 100));
      paxPath = undefined;
      if ((type === "0" || type === "\0") && /^[^/]+\/deepika-sync$/.test(name)) found.push(body);
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  if (found.length !== 1) throw new Error("The archive does not hold exactly one deepika-sync executable");
  return found[0];
}

/** `deepika-sync 0.6.1` → `0.6.1`. */
export function parseVersion(output: string): string | undefined {
  return /^deepika-sync (\d+\.\d+\.\d+)\s*$/.exec(output.trim())?.[1];
}

/** Negative, zero or positive, as `a` is older, the same or newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export type InstallDeps = {
  /** Plugin folder, where the daemon goes. */
  folder: string;
  platform: string;
  arch: string;
  /** Downloads a URL, following redirects; rejects on an HTTP error. */
  get: (url: string) => Promise<ArrayBuffer>;
  /** What `<binary> --version` prints. */
  version: (binary: string) => Promise<string>;
};

/** Downloads, checks and installs the daemon release; resolves with its path. A failure
 *  at any step leaves the daemon previously installed, if any, in place. */
export async function installDaemon(deps: InstallDeps, release = DAEMON_RELEASE): Promise<string> {
  const build = daemonTarget(deps.platform, deps.arch);
  if (!build) throw new Error(`deepika-sync has no build for ${deps.platform} ${deps.arch} yet.`);
  const file = archiveName(release, build.target);
  const sums = new TextDecoder().decode(await deps.get(downloadUrl(release, "SHA256SUMS")));
  const expected = expectedChecksum(sums, file);
  const archive = new Uint8Array(await deps.get(downloadUrl(release, file)));
  if (sha256(archive) !== expected) throw new Error(`Checksum mismatch for ${file}: download refused.`);
  const daemon = extractDaemon(archive);
  const target = join(deps.folder, DAEMON_FILE);
  const partial = `${target}.download`;
  try {
    await writeFile(partial, daemon, { mode: 0o755 });
    await chmod(partial, 0o755);
    const announced = parseVersion(await deps.version(partial));
    if (announced !== release) throw new Error(`The downloaded daemon announces ${announced ?? "no version"}, not ${release}.`);
    // A rename: a daemon already running keeps its own file until it restarts.
    await rename(partial, target);
  } finally {
    await rm(partial, { force: true });
  }
  return target;
}
