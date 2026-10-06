import { build } from "esbuild";
import { readFileSync } from "node:fs";
const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const pkg = read("package.json");
const manifest = read("manifest.json");
const lock = read("package-lock.json");
if (pkg.version !== manifest.version || pkg.version !== lock.version || pkg.version !== lock.packages[""].version) {
  throw new Error("Version mismatch: package.json, manifest.json and package-lock.json must agree");
}
await build({
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2022",
  external: [
    "obsidian",
    "electron",
    "@codemirror/state",
    "@codemirror/view",
    "@codemirror/language",
    "@lezer/common",
  ],
});
