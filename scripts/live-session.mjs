// Two real Obsidian windows, connected to each other, left running for manual testing.
// Isolated profiles and throwaway vaults: never touches the user's own Obsidian or vaults.
//
//   DEEPIKA_SYNC_BINARY=/chemin/absolu/deepika-sync node scripts/live-session.mjs
//
// The windows stay open after this script exits. It prints how to stop them.
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const binary = process.env.DEEPIKA_SYNC_BINARY;
if (!binary || !isAbsolute(binary) || !existsSync(binary)) {
  throw new Error(
    "Définir DEEPIKA_SYNC_BINARY sur le chemin absolu du daemon à tester",
  );
}
const obsidianBinary = process.env.OBSIDIAN_BINARY || "/usr/bin/obsidian";
if (!existsSync(obsidianBinary)) {
  throw new Error(`Obsidian introuvable : ${obsidianBinary}`);
}
const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const base = mkdtempSync(join(tmpdir(), "deepika-sync-live-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = [];

async function until(fn, ms = 60000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(150);
  }
  throw new Error(`Délai dépassé${last ? ` (${last.message})` : ""}`);
}

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}

// Detached, so the windows and daemons outlive this script.
function launch(command, args, tag, capture) {
  const child = spawn(command, args, {
    detached: true,
    stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"],
  });
  child.stderr.on("data", (b) =>
    writeFileSync(join(base, `${tag}.stderr`), b, { flag: "a" }),
  );
  child.on("error", (e) => console.error(tag, e.message));
  started.push({ tag, pid: child.pid });
  child.unref();
  return child;
}

async function cdp(port) {
  const pages = await until(async () => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    return list.some((x) => x.type === "page") && list;
  });
  const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  };
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const request = ++id;
      const timer = setTimeout(() => {
        pending.delete(request);
        reject(new Error(`${method} sans réponse`));
      }, 15000);
      pending.set(request, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      ws.send(JSON.stringify({ id: request, method, params }));
    });
  return {
    close: () => ws.close(),
    eval: async (expression) => {
      const r = await call("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    },
  };
}

async function daemon(root, invite) {
  const p = launch(
    binary,
    invite ? ["join", invite, "--root", root, "--ws-port", "0", "--yes"] : ["share", root, "--ws-port", "0"],
    `daemon-${invite ? "bob" : "alice"}`,
    true,
  );
  let out = "";
  p.stdout.on("data", (b) => (out += b));
  const code = await until(() => out.match(/Code d'invitation : (.+)\n/)?.[1]);
  return { code, pid: p.pid };
}

async function obsidian(who, invite) {
  const home = join(base, who);
  const vault = join(home, "vault");
  const docs = join(vault, "docs");
  const profile = join(home, "profile");
  const plugin = join(vault, ".obsidian/plugins/dot-sync");
  mkdirSync(docs, { recursive: true });
  mkdirSync(join(docs, "notes"), { recursive: true });
  mkdirSync(profile, { recursive: true });
  mkdirSync(plugin, { recursive: true });
  if (!invite) {
    writeFileSync(
      join(docs, "architecture.md"),
      "# Architecture\n\nUn paragraphe partagé.\n",
    );
    writeFileSync(join(docs, "notes/une.md"), "Première note.\n");
    writeFileSync(join(docs, "notes/deux.md"), "Deuxième note.\n");
  }
  for (const file of ["main.js", "manifest.json", "styles.css"])
    copyFileSync(join(pluginRoot, file), join(plugin, file));
  writeFileSync(
    join(plugin, "data.json"),
    JSON.stringify({ root: docs, binary, name: who, relay: false }),
  );
  writeFileSync(
    join(vault, ".obsidian/community-plugins.json"),
    JSON.stringify(["dot-sync"]),
  );
  writeFileSync(
    join(vault, ".obsidian/app.json"),
    JSON.stringify({ safeMode: false, livePreview: true }),
  );
  writeFileSync(
    join(profile, "obsidian.json"),
    JSON.stringify({
      vaults: { [who]: { path: vault, ts: Date.now(), open: true } },
    }),
  );
  const running = await daemon(docs, invite);
  const port = await freePort();
  launch(
    obsidianBinary,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-sandbox",
    ],
    who,
  );
  const dev = await cdp(port);
  await until(() => dev.eval('typeof app !== "undefined" && !!app.workspace'));
  // The vault trust modal appears late and follows the system language.
  await until(
    () =>
      dev.eval(
        `(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>/Trust author and enable plugins|Faites confiance/.test(b.textContent));b?.click();return !!b})()`,
      ),
    8000,
  ).catch(() => {});
  await sleep(500);
  await dev.eval(
    `(async()=>{await app.plugins.enablePluginAndSave('dot-sync');await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('docs/architecture.md'));return true;})()`,
  );
  await until(() =>
    dev.eval(`[...app.plugins.plugins['dot-sync'].bindings][0]?.bound===true`),
  );
  dev.close();
  return { ...running, docs, vault };
}

console.log(`Profils isolés : ${base}\nDémarrage d'Alice…`);
const alice = await obsidian("Alice");
console.log("Alice prête. Démarrage de Bob…");
const bob = await obsidian("Bob", alice.code);
console.log("Bob prêt.\n");

const daemonLog = (docs) => join(docs, ".collab/daemon.log");
const pids = started.map((s) => s.pid).join(" ");

console.log(`Deux Obsidian sont ouverts et connectés. Les fenêtres restent en place.

  Alice   coffre ${alice.vault}
          racine ${alice.docs}
          journal ${daemonLog(alice.docs)}
  Bob     coffre ${bob.vault}
          racine ${bob.docs}
          journal ${daemonLog(bob.docs)}

À essayer, dans l'ordre où cela révèle le plus :

  1. Coédition       taper dans architecture.md des deux côtés, en même temps.
  2. Curseurs        cliquer dans la note chez Alice : son curseur et son nom
                     apparaissent chez Bob (et inversement).
  3. Renommage       renommer une note de notes/ chez Bob, puis ouvrir
                     immédiatement architecture.md : elle doit rester réactive.
  4. Dossier         renommer le dossier notes/ chez Alice pendant que Bob édite
                     notes/une.md. Identité conservée, aucun doublon.
  5. Reprise         tuer le daemon de Bob (kill -9), taper chez Bob, puis relancer
                     le daemon avec Start session : ce qui a été tapé se fusionne.
  6. Hors éditeur    fermer la note chez Bob, puis
                       printf '\\nligne externe\\n' >> ${join(bob.docs, "architecture.md")}
                     la ligne apparaît dans l'éditeur d'Alice.

Relire ensuite les journaux (depuis le dépôt du daemon) :

  python3 scripts/diagnose.py ${alice.docs} ${bob.docs} --timeline

Tout arrêter :

  kill ${pids}
  rm -rf ${base}
`);
