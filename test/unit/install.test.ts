import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { archiveName, compareVersions, daemonTarget, downloadUrl, expectedChecksum, extractDaemon, installDaemon, parseVersion, sha256 } from "../../src/install";

/** A tar entry as Python's tarfile writes it: ustar header, then the body in 512-byte blocks. */
function entry(name: string, body: Uint8Array, type = "0", prefix = ""): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write(body.length.toString(8).padStart(11, "0"), 124);
  header.write(type, 156);
  header.write("ustar", 257);
  header.write(prefix, 345, 155);
  return Buffer.concat([header, Buffer.from(body), Buffer.alloc((512 - (body.length % 512)) % 512)]);
}
const tgz = (...entries: Buffer[]) => gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
/** A PAX record: its length, digits included, then ` path=…`. */
const pax = (path: string) => {
  const rest = ` path=${path}\n`;
  let length = rest.length + 1;
  while (String(length).length + rest.length !== length) length = String(length).length + rest.length;
  return Buffer.from(`${length}${rest}`);
};
const daemon = Buffer.from("#!/bin/sh\necho 'deepika-sync 0.6.1'\n");
const release = (target: string, body = daemon) => tgz(
  entry(`deepika-sync-v0.6.1-${target}/README.md`, Buffer.from("# deepika-sync")),
  entry(`deepika-sync-v0.6.1-${target}/deepika-sync`, body),
);

describe("daemon builds", () => {
  it("has one for Linux and macOS, x86_64 and arm64, and none for Windows yet", () => {
    expect(daemonTarget("linux", "x64")?.target).toBe("x86_64-unknown-linux-musl");
    expect(daemonTarget("linux", "arm64")?.target).toBe("aarch64-unknown-linux-musl");
    expect(daemonTarget("darwin", "arm64")?.target).toBe("aarch64-apple-darwin");
    expect(daemonTarget("darwin", "x64")?.label).toBe("macOS (Intel)");
    for (const [platform, arch] of [["win32", "x64"], ["linux", "ia32"], ["freebsd", "x64"]]) expect(daemonTarget(platform, arch)).toBeUndefined();
  });
  it("downloads from the GitHub release of the version", () => {
    expect(downloadUrl("0.6.1", archiveName("0.6.1", "aarch64-apple-darwin")))
      .toBe("https://github.com/deepika-public/deepika-sync/releases/download/v0.6.1/deepika-sync-v0.6.1-aarch64-apple-darwin.tar.gz");
  });
});

describe("release checks", () => {
  const sum = "a".repeat(64);
  it("takes the one checksum naming the archive", () => {
    const sums = `${"b".repeat(64)}  other.tar.gz\n${sum}  wanted.tar.gz\n`;
    expect(expectedChecksum(sums, "wanted.tar.gz")).toBe(sum);
    expect(expectedChecksum(`${sum} *wanted.tar.gz`, "wanted.tar.gz")).toBe(sum);
  });
  it("refuses a missing, duplicated or malformed checksum", () => {
    for (const sums of ["", `${sum}  other.tar.gz`, `${sum}  wanted.tar.gz\n${sum}  wanted.tar.gz`, "xyz  wanted.tar.gz"]) {
      expect(() => expectedChecksum(sums, "wanted.tar.gz")).toThrow(/no single checksum/);
    }
  });
  it("reads the version the daemon announces and orders versions", () => {
    expect(parseVersion("deepika-sync 0.6.1\n")).toBe("0.6.1");
    expect(parseVersion("syncparty 0.5.2")).toBeUndefined();
    expect(compareVersions("0.6.0", "0.6.1")).toBeLessThan(0);
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.6.1", "0.6.1")).toBe(0);
  });
});

describe("unpacking the daemon", () => {
  it("finds the executable next to the documentation", () => {
    expect(Buffer.from(extractDaemon(release("aarch64-apple-darwin")))).toEqual(daemon);
  });
  it("follows ustar prefixes and PAX paths", () => {
    expect(Buffer.from(extractDaemon(tgz(entry("deepika-sync", daemon, "0", "deepika-sync-v0.6.1-x"))))).toEqual(daemon);
    const long = `deepika-sync-v0.6.1-${"x".repeat(120)}/deepika-sync`;
    expect(Buffer.from(extractDaemon(tgz(entry("PaxHeader", pax(long), "x"), entry("truncated", daemon))))).toEqual(daemon);
  });
  it("refuses an archive without exactly one daemon at its top folder", () => {
    for (const archive of [
      tgz(entry("d/README.md", Buffer.from("x"))),
      tgz(entry("d/deepika-sync", daemon), entry("e/deepika-sync", daemon)),
      tgz(entry("d/bin/deepika-sync", daemon)),
      tgz(entry("d/deepika-sync", Buffer.alloc(0), "5")),
    ]) expect(() => extractDaemon(archive)).toThrow(/exactly one/);
    expect(() => extractDaemon(gzipSync(entry("d/deepika-sync", daemon).subarray(0, 520)))).toThrow(/Truncated/);
  });
});

describe("installing the daemon", () => {
  const target = "x86_64-unknown-linux-musl";
  const setup = (archive = release(target), sums?: string, announces = "deepika-sync 0.6.1") => {
    const folder = mkdtempSync(join(tmpdir(), "dot-sync-install-"));
    const requests: string[] = [];
    const deps = {
      folder, platform: "linux", arch: "x64",
      get: (url: string) => {
        requests.push(url);
        const body = url.endsWith("SHA256SUMS") ? Buffer.from(sums ?? `${sha256(archive)}  ${archiveName("0.6.1", target)}\n`) : archive;
        return Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
      },
      version: () => Promise.resolve(announces),
    };
    return { folder, requests, deps, done: () => rmSync(folder, { recursive: true, force: true }) };
  };

  it("checks the archive, then places an executable daemon in the plugin folder", async () => {
    const { folder, requests, deps, done } = setup();
    try {
      const path = await installDaemon(deps);
      expect(path).toBe(join(folder, "deepika-sync"));
      expect(readFileSync(path)).toEqual(daemon);
      expect(statSync(path).mode & 0o111).not.toBe(0);
      expect(requests.map((url) => url.split("/").pop())).toEqual(["SHA256SUMS", archiveName("0.6.1", target)]);
      expect(existsSync(`${path}.download`)).toBe(false);
    } finally { done(); }
  });
  it("leaves the installed daemon alone when anything is wrong", async () => {
    const cases: [ReturnType<typeof setup>, RegExp][] = [
      [setup(release(target), `${"0".repeat(64)}  ${archiveName("0.6.1", target)}\n`), /Checksum mismatch/],
      [setup(release(target), ""), /no single checksum/],
      [setup(release(target), undefined, "deepika-sync 0.6.0"), /announces 0.6.0/],
      [setup(tgz(entry("d/README.md", Buffer.from("x")))), /exactly one/],
    ];
    for (const [{ folder, deps, done }, error] of cases) {
      try {
        writeFileSync(join(folder, "deepika-sync"), "previous");
        await expect(installDaemon(deps)).rejects.toThrow(error);
        expect(readFileSync(join(folder, "deepika-sync"), "utf8")).toBe("previous");
        expect(existsSync(join(folder, "deepika-sync.download"))).toBe(false);
      } finally { done(); }
    }
  });
  it("names the system it has no build for, before any download", async () => {
    const { deps, requests, done } = setup();
    try {
      await expect(installDaemon({ ...deps, platform: "win32" })).rejects.toThrow(/no build for win32 x64/);
      expect(requests).toEqual([]);
    } finally { done(); }
  });
});
