import { realpathSync } from "node:fs";
import { relative, isAbsolute, resolve } from "node:path";

export function folderRoot(vault: string, path: string): string {
  const base = realpathSync(vault);
  const root = realpathSync(resolve(base, path === "/" ? "." : path));
  const rel = relative(base, root);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith("../") ||
      (rel && rel.split("/").some(part => part.startsWith(".")))) {
    throw new Error("Choose a visible folder inside this vault.");
  }
  return root;
}

/** The path of a vault file inside the shared root, or undefined when it is outside,
 *  hidden, or not a Markdown note -- the daemon only shares `.md` files. */
export function sharedPath(root: string, vault: string, path: string): string | undefined {
  const rel = relative(root, resolve(vault, path));
  if (!rel || isAbsolute(rel) || rel.startsWith("../") || !rel.endsWith(".md") ||
      rel.split("/").some(part => part.startsWith("."))) return undefined;
  return rel;
}
