// Optional real Obsidian Desktop acceptance test, using isolated profiles and vaults.
// Never attaches to an existing Obsidian window or modifies the user's vaults.
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
const binary = process.env.DEEPIKA_SYNC_BINARY;
if (!binary || !isAbsolute(binary) || !existsSync(binary)) {
  throw new Error("Set DEEPIKA_SYNC_BINARY to the absolute path of the daemon to test");
}
const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const base = mkdtempSync(join(tmpdir(), "deepika-sync-obs-"));
const processes = [];
const clients = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(100);
  }
  throw new Error("Timed out");
}
async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function cdp(port) {
  const pages = await until(async () => {
    const p = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    return p.some((x) => x.type === "page") && p;
  });
  const target = pages.find((p) => p.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  clients.push(ws);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      m.error
        ? p.reject(new Error(JSON.stringify(m.error)))
        : p.resolve(m.result);
    }
  };
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const request = ++id;
      const timer = setTimeout(() => {
        pending.delete(request);
        reject(new Error("CDP timeout: " + method));
      }, 10000);
      pending.set(request, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id: request, method, params }));
    });
  return {
    call,
    eval: async (expression) => {
      const r = await call("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails)
        throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    },
  };
}
function launch(command, args, tag) {
  const p = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  processes.push(p);
  p.stderr.on("data", (b) =>
    writeFileSync(join(base, `${tag}.stderr`), b, { flag: "a" }),
  );
  p.on("error", (e) => console.error(tag, e));
  return p;
}
async function daemon(root, invite) {
  const p = launch(
    binary,
    invite ? ["join", invite, "--root", root, "--ws-port", "0", "--yes"] : ["share", root, "--ws-port", "0"],
    "daemon",
  );
  let out = "";
  p.stdout.on("data", (b) => (out += b));
  return {
    process: p,
    code: await until(() => out.match(/Code d'invitation : (.+)\n/)?.[1]),
  };
}
async function obsidian(who, invite) {
  const home = join(base, who),
    vault = join(home, "vault"),
    docs = join(vault, "docs"),
    profile = join(home, "profile"),
    plugin = join(vault, ".obsidian/plugins/dot-sync");
  mkdirSync(docs, { recursive: true });
  mkdirSync(profile, { recursive: true });
  mkdirSync(plugin, { recursive: true });
  writeFileSync(
    join(docs, "architecture.md"),
    "# Architecture\n\nSame paragraph.\n",
  );
  for (const file of ["main.js", "manifest.json", "styles.css"])
    copyFileSync(join(pluginRoot, file), join(plugin, file));
  writeFileSync(
    join(plugin, "data.json"),
    JSON.stringify({
      root: docs,
      binary: binary,
      name: who,
      relay: false,
    }),
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
  const code = running.code;
  const port = await freePort();
  const app = launch(
    process.env.OBSIDIAN_BINARY || "/usr/bin/obsidian",
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-sandbox",
    ],
    who,
  );
  const dev = await cdp(port);
  // y-codemirror only publishes the cursor of a focused editor; a driven window never has OS focus.
  await dev.call("Emulation.setFocusEmulationEnabled", { enabled: true });
  await until(() => dev.eval('typeof app !== "undefined" && !!app.workspace'));
  // The vault trust modal can appear late and follows the system language.
  await until(() =>
    dev.eval(
      `(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>/Trust author and enable plugins|Faites confiance/.test(b.textContent));b?.click();return !!b})()`,
    ),
    5000,
  ).catch(() => {});
  await sleep(500);
  await dev.eval(
    `(async()=>{await app.plugins.enablePluginAndSave('dot-sync');await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('docs/architecture.md'));return true;})()`,
  );
  await until(() =>
    dev.eval(`app.plugins.plugins['dot-sync']?.bindings.size===1`),
  ).catch(async (e) => {
    console.log(
      "UI DEBUG",
      await dev.eval(
        `JSON.stringify({plugins:Object.keys(app.plugins.plugins),status:document.body.innerText.slice(-2000),cm:document.querySelectorAll('.cm-editor').length,session:app.plugins.plugins['dot-sync']?.session?.ws_port,bindings:app.plugins.plugins['dot-sync']?.bindings?.size})`,
      ),
    );
    throw e;
  });
  await until(() =>
    dev.eval(
      `[...app.plugins.plugins['dot-sync'].bindings][0]?.bound===true`,
    ),
  );
  return { dev, code, docs, daemon: running.process, app };
}
const buffer = `[...app.plugins.plugins['dot-sync'].bindings][0]`;
// Live, non-deleted documents a daemon knows, read without its lock.
const documents = (root) => JSON.parse(execFileSync(binary, ["documents", "--root", root], { encoding: "utf8" })).filter((d) => !d.deleted);
try {
  console.log("Isolated profiles:", base);
  const a = await obsidian("Alice");
  const b = await obsidian("Bob", a.code);
  await until(() => a.dev.eval(`document.querySelector('.nav-folder-title[data-path="docs"] .dot-sync-folder-badge')?.textContent.includes('shared')`));
  await a.dev.eval(`app.commands.executeCommandById('dot-sync:start-session')`);
  await until(() => a.dev.eval(`!!document.querySelector('.prompt-input[placeholder="Choose the folder to collaborate on"]')`));
  await a.dev.eval(`document.querySelector('.prompt-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await Promise.all([
    a.dev.eval(
      `${buffer}.view.dispatch({changes:{from:0,insert:'Alice contribution\\n'}})`,
    ),
    b.dev.eval(
      `${buffer}.view.dispatch({changes:{from:0,insert:'Bob contribution\\n'}})`,
    ),
  ]);
  const text = await until(async () => {
    const [x, y] = await Promise.all([
      a.dev.eval(`${buffer}.view.state.doc.toString()`),
      b.dev.eval(`${buffer}.view.state.doc.toString()`),
    ]);
    return (
      x === y &&
      x.includes("Alice contribution") &&
      x.includes("Bob contribution") &&
      x
    );
  });
  await a.dev.eval(`(()=>{const v=${buffer}.view;v.focus();v.dispatch({selection:{anchor:2,head:7}});return true})()`);
  await until(() =>
    b.dev.eval(
      `Array.from(document.querySelectorAll('.cm-ySelectionInfo')).some(e=>e.textContent==='Alice')`,
    ),
  );
  await until(
    () =>
      readFileSync(join(a.docs, "architecture.md"), "utf8") === text &&
      readFileSync(join(b.docs, "architecture.md"), "utf8") === text,
  );
  // Continuous typing on both editors; verify every contribution exactly once.
  await Promise.all(
    [a, b].map((peer, index) =>
      peer.dev.eval(
        `(async()=>{for(let i=0;i<20;i++){${buffer}.view.dispatch({changes:{from:0,insert:'type${index}-'+i+'\\n'},userEvent:'input.type'});await new Promise(r=>setTimeout(r,15));}return true;})()`,
      ),
    ),
  );
  const typed = await until(async () => {
    const x = await a.dev.eval(`${buffer}.view.state.doc.toString()`),
      y = await b.dev.eval(`${buffer}.view.state.doc.toString()`);
    return (
      x === y &&
      Array.from({ length: 2 }, (_, p) =>
        Array.from({ length: 20 }, (_, i) => `type${p}-${i}\n`),
      )
        .flat()
        .every((t) => x.split(t).length === 2) &&
      x
    );
  });
  await sleep(600);
  const pasted = "PASTE😀\n".repeat(100);
  await a.dev.eval(
    `${buffer}.view.dispatch({changes:{from:0,insert:${JSON.stringify(pasted)}},userEvent:'input.paste'})`,
  );
  await until(
    async () =>
      (await b.dev.eval(`${buffer}.view.state.doc.toString()`)) ==
      pasted + typed,
  );
  await a.dev.eval("app.workspace.activeEditor.editor.undo()");
  await until(
    async () =>
      (await a.dev.eval(`${buffer}.view.state.doc.toString()`)) === typed &&
      (await b.dev.eval(`${buffer}.view.state.doc.toString()`)) === typed,
  );
  // Causally concurrent offline edits with both real UI adapters still alive.
  a.daemon.kill("SIGSTOP");
  await b.dev.eval(
    `${buffer}.view.dispatch({changes:{from:0,insert:'Offline Bob\\n'}})`,
  );
  await sleep(500);
  b.daemon.kill("SIGSTOP");
  a.daemon.kill("SIGCONT");
  await a.dev.eval(
    `${buffer}.view.dispatch({changes:{from:0,insert:'Offline Alice\\n'}})`,
  );
  await sleep(500);
  b.daemon.kill("SIGCONT");
  await until(async () => {
    const x = await a.dev.eval(`${buffer}.view.state.doc.toString()`),
      y = await b.dev.eval(`${buffer}.view.state.doc.toString()`);
    return x === y && x.includes("Offline Alice") && x.includes("Offline Bob");
  });
  // Kill Bob's daemon, keep Obsidian alive, type, restart and reconnect automatically.
  b.daemon.kill("SIGKILL");
  await sleep(200);
  await b.dev.eval(
    `${buffer}.view.dispatch({changes:{from:0,insert:'During restart\\n'}})`,
  );
  b.daemon = (await daemon(b.docs, a.code)).process;
  await until(async () => {
    const x = await a.dev.eval(`${buffer}.view.state.doc.toString()`),
      y = await b.dev.eval(`${buffer}.view.state.doc.toString()`);
    return (
      x === y &&
      x.includes("During restart") &&
      x.includes("Offline Alice") &&
      x.includes("Offline Bob")
    );
  });
  await until(async () => {
    const x = await a.dev.eval(`${buffer}.view.state.doc.toString()`);
    return (
      readFileSync(join(a.docs, "architecture.md"), "utf8") === x &&
      readFileSync(join(b.docs, "architecture.md"), "utf8") === x
    );
  });
  await a.dev.eval(
    `(()=>{const v=${buffer}.view;v.focus();v.dispatch({selection:{anchor:2,head:7},scrollIntoView:true});return true})()`,
  );
  await b.dev.eval(
    `(()=>{const v=${buffer}.view;v.focus();v.dispatch({selection:{anchor:18},scrollIntoView:true});return true})()`,
  );
  await until(
    async () =>
      (await a.dev.eval(
        `Array.from(document.querySelectorAll('.cm-ySelectionInfo')).some(e=>e.textContent==='Bob')`,
      )) &&
      (await b.dev.eval(
        `Array.from(document.querySelectorAll('.cm-ySelectionInfo')).some(e=>e.textContent==='Alice')`,
      )),
  );
  for (const [name, peer] of [
    ["alice", a],
    ["bob", b],
  ]) {
    await peer.dev.call("Page.bringToFront");
    const shot = await peer.dev.call("Page.captureScreenshot", {
      format: "png",
    });
    writeFileSync(join(base, `${name}.png`), Buffer.from(shot.data, "base64"));
  }
  console.log(
    "PASS: real Obsidian windows, simultaneous buffer edits, continuous typing, Unicode paste/undo, identical saved Markdown, visible Alice cursor label, offline convergence and daemon crash/reconnect.",
  );
  console.log("Screenshots:", base);
  const identity = documents(a.docs).map((d) => d.id);
  assert.equal(identity.length, 1);
  const rename = async (from, to) => {
    await a.dev.eval(`(async()=>{await app.fileManager.renameFile(app.vault.getAbstractFileByPath(${JSON.stringify(from)}),${JSON.stringify(to)});return true;})()`);
    const relative = to.slice('docs/'.length);
    const settled = `${buffer}?.path===${JSON.stringify(relative)} && ${buffer}?.metadata.get('path')===${JSON.stringify(relative)}`;
    await until(async () => (await a.dev.eval(settled)) && (await b.dev.eval(settled)))
      .catch(async error => {
        for (const peer of [a,b]) console.log('RENAME DEBUG', await peer.dev.eval(`(()=>{const p=app.plugins.plugins['dot-sync'];return JSON.stringify({status:p.status.textContent,bindings:[...p.bindings].map(b=>({path:b.path,meta:b.metadata.get('path'),bound:b.bound,deleted:b.deleted}))})})()`), JSON.stringify(documents(peer.docs)));
        throw error;
      });
    for (const peer of [a,b]) assert.deepEqual(documents(peer.docs).map((d) => d.id), identity);
  };
  await rename('docs/architecture.md','docs/renamed.md');
  b.daemon.kill('SIGSTOP');
  await a.dev.eval(`(async()=>{await app.fileManager.renameFile(app.vault.getAbstractFileByPath('docs/renamed.md'),'docs/offline.md');return true;})()`);
  await a.dev.eval(`${buffer}.view.dispatch({changes:{from:0,insert:'Rename offline Alice\\n'}})`);
  await b.dev.eval(`${buffer}.view.dispatch({changes:{from:0,insert:'Rename offline Bob\\n'}})`);
  b.daemon.kill('SIGCONT');
  await until(async () => {
    const x = await a.dev.eval(`${buffer}.view.state.doc.toString()`);
    const y = await b.dev.eval(`${buffer}.view.state.doc.toString()`);
    return x === y && x.includes('Rename offline Alice') && x.includes('Rename offline Bob') &&
      (await b.dev.eval(`${buffer}.path==='offline.md'`));
  });
  await a.dev.eval(`(async()=>{await app.vault.createFolder('docs/group');return true;})()`);
  await rename('docs/offline.md','docs/group/note.md');
  // A native directory move must keep its descendant's editor and CRDT UUID.
  await a.dev.eval(`(async()=>{await app.fileManager.renameFile(app.vault.getAbstractFileByPath('docs/group'),'docs/moved');return true;})()`);
  await until(async () => (await a.dev.eval(`${buffer}?.metadata.get('path')==='moved/note.md'`)) && (await b.dev.eval(`${buffer}?.path==='moved/note.md'`)));
  await b.dev.eval(`${buffer}.view.dispatch({changes:{from:0,insert:'After folder rename\\n'}})`);
  await until(async () => (await a.dev.eval(`${buffer}.view.state.doc.toString()`)) === (await b.dev.eval(`${buffer}.view.state.doc.toString()`)) &&
    readFileSync(join(a.docs,'moved/note.md'),'utf8')===readFileSync(join(b.docs,'moved/note.md'),'utf8'));
  await rename('docs/moved/note.md','docs/architecture.md');
  for (const peer of [a, b]) assert.deepEqual(documents(peer.docs).map((d) => d.id), identity);
  console.log('PASS: open-note rename, move into folder, folder rename, edits after move and stable UUID on both peers.');
  // Obsidian "New note": create Untitled.md, open it, rename it from the inline
  // title at once, then type. No warning may appear on either peer.
  for (const peer of [a, b]) await peer.dev.eval(`(()=>{const p=app.plugins.plugins['dot-sync'];p.warnings=[];const w=p.warn.bind(p);p.warn=t=>{p.warnings.push(t);w(t)};return true})()`);
  // A binary attachment has no CRDT identity: renaming it must not block the queue.
  await a.dev.eval(`(async()=>{const f=await app.vault.createBinary('docs/img.png',new Uint8Array([137,80,78,71,0,255]).buffer);await app.fileManager.renameFile(f,'docs/photo.png');return true})()`);
  await sleep(500);
  const newNote = (who, path) => `[...app.plugins.plugins['dot-sync'].bindings].find(x=>x.path===${JSON.stringify(path)})`;
  await a.dev.eval(`(async()=>{const f=await app.vault.create('docs/Untitled.md','');await app.workspace.getLeaf('tab').openFile(f);await app.fileManager.renameFile(f,'docs/Fichier Adrien.md');app.workspace.activeEditor.editor.replaceRange('Adrien écrit\\n',{line:0,ch:0});return true})()`);
  await until(() => b.dev.eval(`!!app.vault.getAbstractFileByPath('docs/Fichier Adrien.md')`));
  await b.dev.eval(`(async()=>{await app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath('docs/Fichier Adrien.md'));return true})()`);
  await until(async () => (await b.dev.eval(`${newNote(b, 'Fichier Adrien.md')}?.ytext.toString().includes('Adrien écrit')===true`)));
  await b.dev.eval(`${newNote(b, 'Fichier Adrien.md')}.view.dispatch({changes:{from:0,insert:'Bob répond\\n'}})`);
  await a.dev.eval(`${newNote(a, 'Fichier Adrien.md')}.view.dispatch({changes:{from:0,insert:'Adrien continue\\n'}})`);
  await until(async () => {
    const x = await a.dev.eval(`${newNote(a, 'Fichier Adrien.md')}?.view.state.doc.toString()`);
    const y = await b.dev.eval(`${newNote(b, 'Fichier Adrien.md')}?.view.state.doc.toString()`);
    return x === y && ['Adrien écrit', 'Bob répond', 'Adrien continue'].every(t => x.includes(t));
  }).catch(async error => {
    for (const peer of [a, b]) console.log('NEW NOTE DEBUG', await peer.dev.eval(`(()=>{const p=app.plugins.plugins['dot-sync'];return JSON.stringify({warnings:p.warnings,bindings:[...p.bindings].map(b=>({path:b.path,meta:b.metadata.get('path'),bound:b.bound,text:b.view.state.doc.toString()}))})})()`));
    throw error;
  });
  const warnings = {};
  for (const [name, peer] of [['Alice', a], ['Bob', b]]) warnings[name] = JSON.parse(await peer.dev.eval(`JSON.stringify(app.plugins.plugins['dot-sync'].warnings)`));
  assert.deepEqual(warnings, { Alice: [], Bob: [] });
  assert.equal(existsSync(join(a.docs, 'Untitled.md')) || existsSync(join(b.docs, 'Untitled.md')), false);
  console.log('PASS: attachment rename, new note renamed from its title right away, typed on both peers without warning.');
  // Session UI: releasing editors, choosing another folder, launching from the
  // context-menu action, and reporting a missing executable without losing data.
  await a.dev.eval(`app.workspace.detachLeavesOfType('markdown')`);
  await until(() => a.dev.eval(`app.plugins.plugins['dot-sync'].bindings.size===0`));
  await a.dev.eval(`app.plugins.plugins['dot-sync'].leave()`);
  assert.equal(await a.dev.eval(`app.plugins.plugins['dot-sync'].config.root`), "");
  await a.dev.eval(`(async()=>{await app.vault.createFolder('Next session');return true;})()`);
  await a.dev.eval(`(()=>{const actions=[];const menu={addSeparator(){return this},addItem(fn){const item={title:'',setTitle(v){this.title=v;return this},setIcon(){return this},setDisabled(){return this},onClick(fn){actions.push([this.title,fn]);return this}};fn(item);return this}};app.workspace.trigger('file-menu',menu,app.vault.getAbstractFileByPath('Next session'),'file-explorer');actions.find(([name])=>name==='Start dot-sync session in this folder')[1]();})()`);
  await until(() => a.dev.eval(`!!app.plugins.plugins['dot-sync'].session && app.plugins.plugins['dot-sync'].config.root.endsWith('/Next session')`));
  await until(() => a.dev.eval(`document.querySelector('.nav-folder-title[data-path="Next session"] .dot-sync-folder-badge')?.textContent==='shared'`));
  await until(() => a.dev.eval(`document.querySelector('.dot-sync-invitation')?.value.length>0`));
  // This session runs without the relay: the window says why it offers no web link.
  assert.equal(await a.dev.eval(`!!document.querySelector('.dot-sync-web-link-unavailable') && !document.querySelector('.dot-sync-web-link')`), true);
  await a.dev.eval(`document.querySelector('.modal-close-button')?.click()`);
  await a.dev.eval(`app.plugins.plugins['dot-sync'].leave()`);
  await a.dev.eval(`app.plugins.plugins['dot-sync'].selectAndLaunch(app.vault.getRoot())`);
  await until(() => a.dev.eval(`!!app.plugins.plugins['dot-sync'].session && document.querySelector('.nav-header .dot-sync-folder-badge')?.textContent==='dot-sync · shared'`));
  await until(() => a.dev.eval(`document.querySelector('.dot-sync-invitation')?.value.length>0`));
  await a.dev.eval(`document.querySelector('.modal-close-button')?.click()`);
  await a.dev.eval(`(async()=>{for(let i=0;i<4;i++){await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('docs/architecture.md'));app.workspace.detachLeavesOfType('markdown');}return true;})()`);
  await until(() => a.dev.eval(`app.plugins.plugins['dot-sync'].bindings.size===0`)).catch(async e => {
    console.log("CLOSE DEBUG", await a.dev.eval(`(()=>{const p=app.plugins.plugins['dot-sync'];return JSON.stringify({bindings:[...p.bindings].map(b=>({path:b.path,bound:b.bound})),status:p.status.textContent})})()`));
    throw e;
  });
  await a.dev.eval(`app.plugins.plugins['dot-sync'].leave()`);
  assert.equal(await a.dev.eval(`app.plugins.plugins['dot-sync'].config.root`), "");
  console.log("PASS: vault-root session badge, automatic invitation, rapid editor close and leave without open notes.");
  // Joining shows what the folder is about to go through, and takes no for an answer.
  const bobInvite = JSON.parse(readFileSync(join(b.docs, ".collab/session.json"), "utf8")).invite;
  const joining = join(a.docs, "..", "Joining");
  await a.dev.eval(`(async()=>{await app.vault.createFolder('Joining');await app.vault.create('Joining/architecture.md','Alice kept her own text\\n');await app.vault.create('Joining/only mine.md','x');return true})()`);
  const previewText = async () => until(() => a.dev.eval(`document.querySelector('.dot-sync-join-preview')?.innerText`));
  const press = (label) => a.dev.eval(`(()=>{const b=[...document.querySelectorAll('.dot-sync-join-preview button')].find(b=>b.textContent===${JSON.stringify(label)});b.click();return true})()`);
  const startJoin = () => a.dev.eval(`(()=>{const p=app.plugins.plugins['dot-sync'];window.joinResult=p.selectAndLaunch(app.vault.getAbstractFileByPath('Joining'),${JSON.stringify(bobInvite)}).then(()=>'done',e=>String(e));return true})()`);
  await startJoin();
  const shown = await previewText();
  assert.match(shown, /Same name, different content/);
  assert.match(shown, /architecture\.md/);
  assert.match(shown, /only mine\.md/);
  writeFileSync(join(base, "join-preview.png"), Buffer.from((await a.dev.call("Page.captureScreenshot", { format: "png" })).data, "base64"));
  assert.equal(existsSync(join(joining, ".collab")), false, "looking must not write");
  await press("Refuse");
  assert.equal(await a.dev.eval(`window.joinResult`), "done");
  assert.equal(await a.dev.eval(`app.plugins.plugins['dot-sync'].config.root`), "");
  assert.equal(existsSync(join(joining, ".collab")), false, "a refusal leaves no trace");
  assert.equal(readFileSync(join(joining, "architecture.md"), "utf8"), "Alice kept her own text\n");
  await startJoin();
  await previewText();
  await press("Accept and join");
  await until(() => a.dev.eval(`!!app.plugins.plugins['dot-sync'].session && app.plugins.plugins['dot-sync'].config.root.endsWith('/Joining')`));
  // Both versions of the clashing note survive, on both sides.
  await until(() => readdirSync(joining).filter((f) => f.startsWith("architecture")).length === 2 &&
    readdirSync(b.docs).filter((f) => f.startsWith("architecture")).length === 2 && existsSync(join(b.docs, "only mine.md")));
  await a.dev.eval(`app.plugins.plugins['dot-sync'].leave()`);
  console.log("PASS: join preview lists the changes, refusing leaves no trace, accepting joins and keeps both versions.");
  await a.dev.eval(`(async()=>{const p=app.plugins.plugins['dot-sync'];p.config.binary='/missing/deepika-sync';await p.selectAndLaunch(app.vault.getAbstractFileByPath('Next session'));})()`);
  await until(() => a.dev.eval(`app.plugins.plugins['dot-sync'].launchError.includes('ENOENT')`));
  console.log("PASS: folder picker, context menu, folder badge, switching folders and executable error.");
  // An update swaps the daemon's file while the old process keeps running: the plugin
  // stops what it cannot talk to and starts the installed daemon in its place.
  const stale = join(a.docs, "..", "Stale");
  await a.dev.eval(`(async()=>{await app.plugins.plugins['dot-sync'].leave();await app.vault.createFolder('Stale');return true;})()`);
  mkdirSync(join(stale, ".collab"), { recursive: true });
  const old = launch("sleep", ["600"], "outdated-daemon");
  writeFileSync(join(stale, ".collab/session.json"), JSON.stringify({ version: "0.5.0", pid: old.pid, root: stale, ws_port: 4444, invite: "old" }));
  await a.dev.eval(`(async()=>{const p=app.plugins.plugins['dot-sync'];p.config.binary=${JSON.stringify(binary)};await p.selectAndLaunch(app.vault.getAbstractFileByPath('Stale'));})()`);
  await until(() => old.exitCode !== null || old.signalCode !== null);
  const renewed = await until(() => a.dev.eval(`app.plugins.plugins['dot-sync'].session?.pid`));
  assert.notEqual(renewed, old.pid);
  assert.equal(JSON.parse(readFileSync(join(stale, ".collab/session.json"), "utf8")).pid, renewed);
  // And a daemon it cannot talk to can always be left.
  await a.dev.eval(`app.plugins.plugins['dot-sync'].leave()`);
  await until(() => !existsSync(join(stale, ".collab/session.json")));
  const deaf = launch("sleep", ["600"], "deaf-daemon");
  writeFileSync(join(stale, ".collab/session.json"), JSON.stringify({ version: "0.1.0", pid: deaf.pid, root: stale }));
  await a.dev.eval(`(async()=>{const p=app.plugins.plugins['dot-sync'];p.replaced.add(${deaf.pid});p.config.root=${JSON.stringify(stale)};p.connect(true);await p.leave();})()`);
  await until(() => deaf.exitCode !== null || deaf.signalCode !== null);
  rmSync(join(stale, ".collab/session.json"), { force: true });
  console.log("PASS: an outdated daemon left running is replaced, and one that cannot be talked to can still be left.");
  // A session started from a window ends with it, even when Obsidian is killed outright.
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  await a.dev.eval(`(async()=>{const p=app.plugins.plugins['dot-sync'];if(p.config.root)await p.leave();p.config.binary=${JSON.stringify(binary)};await p.selectAndLaunch(app.vault.getAbstractFileByPath('Next session'));})()`);
  const started = await until(() => a.dev.eval(`app.plugins.plugins['dot-sync'].session?.pid`));
  assert.equal(alive(started), true);
  a.app.kill("SIGKILL");
  await until(() => !alive(started));
  assert.equal(existsSync(join(a.docs, "..", "Next session", ".collab/session.json")), false, "the session file is withdrawn");
  console.log("PASS: killing Obsidian stops the session it started.");
} finally {
  for (const c of clients) c.close();
  for (const p of processes) {
    p.kill("SIGCONT");
    p.kill("SIGTERM");
  }
  await sleep(300);
  for (const p of processes) if (p.exitCode === null) p.kill("SIGKILL");
}
