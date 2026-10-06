import {
  Plugin,
  PluginSettingTab,
  Setting,
  ButtonComponent,
  Notice,
  Modal,
  App,
  FileSystemAdapter,
  editorInfoField,
  TFolder,
  TFile,
  requestUrl,
} from "obsidian";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { realpathSync } from "node:fs";
import { relative, join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { Binding, collab, remoteOutOfHistory } from "./binding";
import { FolderPicker, FolderBadge, ShareInvitation, JoinPreview, InstallDaemon } from "./session-ui";
import { DAEMON_RELEASE, RELEASES, compareVersions, daemonTarget, installDaemon, parseVersion } from "./install";
import { folderRoot, sharedPath } from "./session-safety";
import { CompatibilityError, JoinPlan, MINIMUM_DAEMON, Session, WEB_PAGE, launchArguments, launchFailure, parsePlan, previewArguments, readSession, resolveBinary, runningPid, isAlive, serverUrl, webLink } from "./session";
interface Config {
  root: string;
  binary: string;
  name: string;
  relay: boolean;
  webPage: string;
  stopOnClose: boolean;
}
class InviteModal extends Modal {
  constructor(
    app: App,
    readonly submit: (s: string) => void,
  ) {
    super(app);
  }
  onOpen() {
    let invite = "";
    new Setting(this.contentEl)
      .setName("Invitation")
      .addText((t) => t.onChange((v) => (invite = v)));
    new Setting(this.contentEl).addButton((b) =>
      b.setButtonText("Join").onClick(() => {
        this.close();
        this.submit(invite.trim());
      }),
    );
  }
}
export default class DotSyncPlugin extends Plugin {
  config: Config = { root: "", binary: "deepika-sync", name: "Peer", relay: false, webPage: WEB_PAGE, stopOnClose: true };
  /** The running daemon serving `config.root`, once found. */
  session?: Session;
  bindings = new Set<Binding>();
  editors = new Set<{ reconcile: () => void }>();
  status!: HTMLElement;
  unloaded = false;
  switching = false;
  launching = false;
  launchError = "";
  badge?: FolderBadge;
  showInviteOnConnect = false;
  /** The pipe whose closing stops the daemon this window started. */
  private lifeline?: NodeJS.WritableStream;
  /** Paths this plugin is itself moving, so its own rename is not handled twice. */
  private moving = new Set<string>();
  async onload() {
    const saved = (await this.loadData()) as Partial<Config> | null;
    for (const key of ["root", "binary", "name", "relay", "webPage", "stopOnClose"] as const) {
      const value = saved?.[key];
      if (value !== undefined) Object.assign(this.config, { [key]: value });
    }
    this.status = this.addStatusBarItem();
    this.status.setText("○ No session · choose a folder to start or join");
    this.registerDomEvent(this.status, "click", () => {
      if (this.session) this.showInvitation();
    });
    this.badge = new FolderBadge(this.app.workspace.containerEl);
    this.register(() => this.badge?.destroy());
    this.addSettingTab(new Settings(this.app, this));
    // The editor extension's class reaches the plugin through `owner`, a parameter.
    const register = (owner: DotSyncPlugin) => this.registerEditorExtension([
      collab.of([]),
      remoteOutOfHistory,
      ViewPlugin.fromClass(
        class {
          destroyed = false;
          binding?: Binding;
          file?: TFile;
          abandoned?: TFile;
          constructor(readonly view: EditorView) {
            owner.editors.add(this);
            queueMicrotask(() => this.reconcile());
          }
          /** Share this editor's note if it should be and is not; stop if it should not. */
          reconcile() {
            if (this.destroyed || owner.unloaded) return;
            const file = this.view.state.field(editorInfoField, false)?.file ?? undefined;
            const path = file && owner.config.root && owner.isOpenEditor(this.view) ? owner.sharedPath(file.path) : undefined;
            if (this.binding && (path === undefined || file !== this.file || this.binding.deleted)) {
              // A note the session deleted is never shared again from this editor.
              if (this.binding.deleted) this.abandoned = this.file;
              owner.release(this.binding);
              this.binding = undefined;
            }
            if (path === undefined || !owner.session || file === this.abandoned) return;
            if (this.binding) {
              if (this.binding.path !== path) this.binding.setPath(path);
              return;
            }
            // Obsidian mirrors the panes of one note itself: a second binding would
            // apply every change twice.
            if ([...owner.bindings].some((b) => b.path === path)) return;
            this.file = file;
            this.binding = new Binding(this.view, path, serverUrl(owner.session), owner.config.name, {
              warn: (text) => owner.warn(text),
              moved: (binding, to) => void owner.followRemotePath(binding, to),
              superseded: (binding) => {
                owner.release(binding);
                if (this.binding === binding) this.binding = undefined;
                queueMicrotask(() => this.reconcile());
              },
            });
            owner.bindings.add(this.binding);
          }
          update(u: ViewUpdate) {
            this.binding?.update(u);
            if (u.state.field(editorInfoField, false)?.file !== this.file) queueMicrotask(() => this.reconcile());
          }
          destroy() {
            this.destroyed = true;
            owner.editors.delete(this);
            if (this.binding) owner.release(this.binding);
          }
        },
      ),
    ]);
    register(this);
    this.registerEvent(this.app.workspace.on("layout-change", () => this.reconcileEditors()));
    // A note renamed here keeps its identity: the daemon sees the move on disk. The open
    // editor only has to ask for the new path if it ever reconnects.
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      const old = this.sharedPath(oldPath, false);
      const next = this.sharedPath(file.path, false);
      if (old === undefined || next === undefined) return;
      for (const binding of this.bindings) {
        if (binding.path === old) binding.setPath(next);
        else if (binding.path.startsWith(old + "/")) binding.setPath(next + binding.path.slice(old.length));
      }
    }));
    this.addCommand({
      id: "start-session",
      name: "Start session",
      callback: () => this.chooseFolder(false),
    });
    this.addCommand({
      id: "join-session",
      name: "Join session",
      callback: () => this.chooseFolder(true),
    });
    this.addCommand({
      id: "leave-session",
      name: "Leave session",
      callback: () => void this.leave().catch(e => this.warn(String(e))),
    });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFolder)) return;
      menu.addSeparator();
      menu.addItem(item => item.setTitle("Start dot-sync session in this folder").setIcon("radio")
        .onClick(() => this.chooseFolder(false, file)));
      menu.addItem(item => item.setTitle("Join dot-sync session in this folder").setIcon("users")
        .onClick(() => this.chooseFolder(true, file)));
      if (this.isSelected(file)) {
        menu.addItem(item => item.setTitle("Copy dot-sync invitation").setIcon("copy")
          .setDisabled(!this.session).onClick(() => this.copyInvitation()));
        menu.addItem(item => item.setTitle("Copy dot-sync web link").setIcon("globe")
          .setDisabled(!this.session).onClick(() => this.copyWebLink()));
        menu.addItem(item => item.setTitle("Leave dot-sync session").setIcon("log-out")
          .onClick(() => void this.leave().catch(e => this.warn(String(e)))));
      }
    }));
    this.addCommand({
      id: "show-invitation",
      name: "Show invitation",
      callback: () => this.showInvitation(),
    });
    this.addCommand({
      id: "copy-invite",
      name: "Copy invite code",
      callback: () => this.copyInvitation(),
    });
    this.addCommand({
      id: "copy-web-link",
      name: "Copy web link",
      callback: () => this.copyWebLink(),
    });
    this.registerInterval(window.setInterval(() => this.connect(), 1500));
    this.connect();
  }
  reconcileEditors() {
    for (const editor of this.editors) editor.reconcile();
  }
  release(binding: Binding) {
    this.bindings.delete(binding);
    binding.destroy();
  }
  isOpenEditor(view: EditorView) {
    let open = false;
    this.app.workspace.iterateAllLeaves(leaf => {
      if (leaf.view.containerEl.contains(view.dom)) open = true;
    });
    return open;
  }
  /** A collaborator renamed an open note. Renaming through Obsidian keeps the editor
   *  open; the daemon finds the file already in place when the lease ends. */
  async followRemotePath(binding: Binding, to: string) {
    const disk = this.app.vault.adapter;
    if (!this.session || !(disk instanceof FileSystemAdapter)) return;
    const base = realpathSync(disk.getBasePath());
    const from = relative(base, join(this.session.root, binding.path));
    const target = relative(base, join(this.session.root, to));
    const file = this.app.vault.getAbstractFileByPath(from);
    if (!(file instanceof TFile) || from === target || this.moving.has(from)) return;
    this.moving.add(from);
    try {
      if (this.app.vault.getAbstractFileByPath(target)) throw new Error(`Rename target already exists: ${target}. Files preserved.`);
      const parts = target.split("/"); parts.pop();
      for (let i = 1; i <= parts.length; i++) {
        const parent = parts.slice(0, i).join("/");
        if (!this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent);
      }
      await this.app.fileManager.renameFile(file, target);
    } catch (error) { this.warn(String(error)); }
    finally { this.moving.delete(from); }
  }
  warn(text: string) {
    new Notice(text, 8000);
    this.status.setText("⚠ Collaboration · " + text.slice(0, 90));
  }
  showState(text: string, badge: string) {
    this.status.setText(text);
    const vault = this.app.vault.adapter;
    const path = this.config.root && vault instanceof FileSystemAdapter
      ? relative(realpathSync(vault.getBasePath()), this.config.root) || "/" : undefined;
    this.badge?.update(path, badge);
  }
  isSelected(folder: TFolder) {
    try { return this.rootFor(folder) === this.config.root; } catch { return false; }
  }
  rootFor(folder: TFolder) {
    const vault = this.app.vault.adapter;
    if (!(vault instanceof FileSystemAdapter)) throw new Error("Desktop filesystem required.");
    return folderRoot(vault.getBasePath(), folder.path);
  }
  chooseFolder(joinSession: boolean, folder?: TFolder) {
    const selected = (value: TFolder) => {
      const launch = (invite?: string) => void this.selectAndLaunch(value, invite)
        .catch(e => this.warn(String(e)));
      if (joinSession) new InviteModal(this.app, invite => {
        if (!invite) { this.warn("Enter an invitation."); return; }
        launch(invite);
      }).open();
      else launch();
    };
    if (folder) selected(folder);
    else new FolderPicker(this.app, selected).open();
  }
  async selectAndLaunch(folder: TFolder, invite?: string) {
    if (this.switching || this.launching) throw new Error("Session operation in progress. Try again shortly.");
    const root = this.rootFor(folder);
    if (this.config.root && this.config.root !== root) {
      throw new Error("Leave the current session before choosing another folder.");
    }
    this.switching = true;
    try {
      // A daemon already serving this folder needs nothing; otherwise one must run here.
      if (!runningPid(root) && !(await this.ensureDaemon())) return;
      // Joining rewrites part of the folder. Show what, and let the user walk away:
      // until they accept, neither the daemon nor the plugin has written anything.
      if (invite && !runningPid(root) && !(await this.reviewJoin(folder, root, invite))) {
        new Notice("Join refused: nothing was changed.");
        return;
      }
      this.config.root = root;
      await this.saveData(this.config);
      this.launchError = "";
      this.showInviteOnConnect = !invite;
      this.connect(true);
      // An outdated daemon being replaced is restarted by that replacement.
      if (this.replacing) return;
      if (!this.session) this.launch(invite);
      else if (invite && invite !== this.session.invite) this.warn("This folder already runs a session; leave it before joining another.");
    } finally { this.switching = false; }
  }
  /** The plugin folder, where an installed daemon lives. */
  pluginFolder(): string | undefined {
    const disk = this.app.vault.adapter;
    return disk instanceof FileSystemAdapter && this.manifest.dir ? join(disk.getBasePath(), this.manifest.dir) : undefined;
  }
  /** The daemon binary: the setting, else one unpacked in the plugin folder, else the PATH. */
  binary() {
    return resolveBinary(this.config.binary, this.pluginFolder());
  }
  /** Whether the Daemon binary setting names another executable than the installed one. */
  customBinary() {
    const chosen = this.config.binary.trim();
    return chosen !== "" && chosen !== "deepika-sync";
  }
  /** The version a daemon binary announces, or none when it cannot run. */
  daemonVersion(binary = this.binary()): Promise<string | undefined> {
    return new Promise((resolve) => execFile(binary, ["--version"], { timeout: 10000 },
      (error, stdout) => resolve(error ? undefined : parseVersion(String(stdout)))));
  }
  /** Downloads, checks and installs the daemon release into the plugin folder. */
  async installDaemon(): Promise<void> {
    const folder = this.pluginFolder();
    if (!folder) throw new Error("Installing the daemon needs the desktop app.");
    await installDaemon({
      folder,
      platform: process.platform,
      arch: process.arch,
      get: async (url) => (await requestUrl({ url })).arrayBuffer,
      version: (binary) => new Promise((resolve, reject) => execFile(binary, ["--version"], { timeout: 10000 },
        (error, stdout) => (error ? reject(new Error(error.message)) : resolve(String(stdout))))),
    });
    new Notice(`deepika-sync ${DAEMON_RELEASE} installed.`);
  }
  /** True once a daemon recent enough can run; otherwise offers to install one. */
  async ensureDaemon(): Promise<boolean> {
    const minimum = MINIMUM_DAEMON.join(".");
    const version = await this.daemonVersion();
    if (version && compareVersions(version, minimum) >= 0) return true;
    if (this.customBinary()) {
      this.warn(version
        ? `The Daemon binary setting runs deepika-sync ${version}; dot-sync needs ${minimum} or later.`
        : `The Daemon binary setting names a program that cannot run: ${this.config.binary}.`);
      return false;
    }
    const build = daemonTarget(process.platform, process.arch);
    if (!build) {
      this.warn(`deepika-sync does not run on this system yet (${process.platform} ${process.arch}). See ${RELEASES}.`);
      return false;
    }
    const reason = version ? `The installed deepika-sync ${version} is too old.` : "deepika-sync is not installed.";
    return new Promise((resolve) => new InstallDaemon(this.app, reason, build.label, DAEMON_RELEASE,
      () => this.installDaemon(), resolve).open());
  }
  /** Ask the daemon what joining would change, show it, and resolve with the decision. */
  async reviewJoin(folder: TFolder, root: string, invite: string): Promise<boolean> {
    this.showState("◌ Inspecting the session…", "");
    const plan = await new Promise<JoinPlan | Error>((resolve) => {
      execFile(this.binary(), previewArguments(root, invite, this.config.relay),
        { timeout: 60000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) resolve(new Error(String(stderr).trim().split("\n").pop() || error.message));
          else try { resolve(parsePlan(stdout)); } catch (e) { resolve(e as Error); }
        });
    });
    this.showState("○ No session · choose a folder to start or join", "");
    const label = folder.isRoot() ? this.app.vault.getName() : folder.path;
    return new Promise((resolve) => new JoinPreview(this.app, label, plan, resolve).open());
  }
  /** Stop the daemon and forget the folder. Open notes are released first, so the
   *  daemon writes their merged text before it exits. */
  async leave() {
    if (this.launching || this.switching) throw new Error("Session operation in progress. Try again shortly.");
    this.switching = true;
    try {
      for (const binding of [...this.bindings]) this.release(binding);
      // By pid alone: a daemon too old to talk to can still be stopped.
      const pid = this.session?.pid ?? this.daemonPid();
      if (pid) {
        // Let the daemon see the sockets close before it is asked to stop.
        await new Promise(resolve => window.setTimeout(resolve, 300));
        try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
      }
      this.session = undefined;
      this.config.root = "";
      this.launchError = "";
      this.showInviteOnConnect = false;
      await this.saveData(this.config);
      this.showState("○ No session · choose a folder to start or join", "");
    } finally { this.switching = false; this.reconcileEditors(); }
  }
  /** Path of a vault file inside the shared root; `existing` resolves symlinks. */
  sharedPath(vaultPath: string, existing = true): string | undefined {
    const disk = this.app.vault.adapter;
    const root = this.session?.root ?? this.config.root;
    if (!(disk instanceof FileSystemAdapter) || !root) return undefined;
    try {
      const base = realpathSync(disk.getBasePath());
      return sharedPath(root, base, existing ? relative(base, realpathSync(join(base, vaultPath))) : vaultPath);
    } catch {
      return undefined;
    }
  }
  /** Look for the daemon serving the chosen folder; runs on a timer, so it also notices
   *  a daemon that died or one that was started from a terminal. */
  connect(force = false) {
    if ((this.switching && !force) || !this.config.root || this.unloaded) return;
    try {
      const session = readSession(realpathSync(this.config.root));
      if (session && (!this.session || session.pid !== this.session.pid || session.ws_port !== this.session.ws_port)) {
        // A restarted daemon listens elsewhere. Open notes keep their replica -- it holds
        // what was typed meanwhile -- and merge it when they reconnect.
        for (const binding of this.bindings) binding.setServer(serverUrl(session));
        this.session = session;
        this.launching = false;
        this.launchError = "";
        this.showState(`● Collaborative session · ${this.config.root}`, "shared");
        if (this.showInviteOnConnect) {
          this.showInviteOnConnect = false;
          new ShareInvitation(this.app, session.invite, this.config.webPage).open();
        }
      } else if (!session) {
        this.session = undefined;
        this.showState(this.launchError || (this.launching ? "◌ Starting session…" : "○ Session stopped · run Start session to resume"), "disconnected");
      }
    } catch (error) {
      this.session = undefined;
      const outdated = error instanceof CompatibilityError ? this.daemonPid() : undefined;
      if (outdated && !this.replaced.has(outdated)) { void this.replaceOutdated(outdated); return; }
      this.showState(error instanceof CompatibilityError ? `⚠ ${error.message}` : `○ Session unavailable · ${String(error)}`, "disconnected");
    }
    this.reconcileEditors();
  }
  private daemonPid(): number | undefined {
    if (!this.config.root) return undefined;
    try { return runningPid(realpathSync(this.config.root)); } catch { return undefined; }
  }
  /** Daemons this window already replaced: if the installed one is outdated too, say so
   *  instead of restarting for ever. */
  private replaced = new Set<number>();
  private replacing = false;
  /** An update swaps the daemon's file while the old process keeps running. The folder's
   *  session lives in `.collab`, not in the process: stop it and start the installed one. */
  async replaceOutdated(pid: number) {
    this.replaced.add(pid);
    this.replacing = true;
    this.switching = true;
    try {
      this.showState("◌ Updating the session's daemon…", "starting");
      try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
      for (let i = 0; i < 50 && isAlive(pid); i++) await new Promise(resolve => window.setTimeout(resolve, 100));
      if (isAlive(pid) || this.unloaded) return;
      new Notice("An outdated deepika-sync daemon was still running after the update. It was restarted; the session continues.", 8000);
      this.launch();
    } finally { this.switching = false; this.replacing = false; }
  }
  showInvitation() {
    if (this.session) new ShareInvitation(this.app, this.session.invite, this.config.webPage).open();
    else this.warn("No running session.");
  }
  copyInvitation() {
    if (!this.session) { this.warn("No running session."); return; }
    void navigator.clipboard.writeText(this.session.invite).catch(e => this.warn(String(e)));
  }
  copyWebLink() {
    if (!this.session) { this.warn("No running session."); return; }
    const link = webLink(this.config.webPage, this.session.invite);
    if ("unavailable" in link) { this.warn(link.unavailable); return; }
    void navigator.clipboard.writeText(link.url).then(() => new Notice("Web link copied")).catch(e => this.warn(String(e)));
  }
  launch(invite?: string) {
    this.launching = true;
    this.showState("◌ Starting session…", "starting");
    // Detached, and found again through its session file. Whether the session outlives
    // Obsidian is the user's choice: when it must not, we hold a pipe to the daemon's
    // standard input and the daemon stops once that pipe closes -- with this window.
    const stop = this.config.stopOnClose;
    const child = spawn(this.binary(), launchArguments(this.config.root, invite, this.config.relay, stop), {
      detached: true,
      stdio: [stop ? "pipe" : "ignore", "ignore", "pipe"],
    });
    this.lifeline = child.stdin ?? undefined;
    child.stdin?.on("error", () => { /* the daemon left first */ });
    let errorOutput = "";
    child.stderr?.on("data", chunk => { errorOutput = (errorOutput + String(chunk)).slice(-4096); });
    const failed = (message: string) => {
      if (this.unloaded) return;
      this.launching = false;
      this.launchError = `Cannot start daemon: ${message}`;
      this.showInviteOnConnect = false;
      this.warn(this.launchError);
      this.badge?.update(undefined, "");
    };
    child.on("error", (e: NodeJS.ErrnoException) => failed(e.code === "ENOENT" && !this.customBinary()
      ? "deepika-sync is not installed. Install it from the dot-sync settings."
      : `${e.message}. Check Daemon binary in settings.`));
    child.on("exit", (code, signal) => {
      this.launching = false;
      if (code !== 0 && signal !== "SIGTERM") failed(launchFailure(errorOutput) || `exit ${code ?? signal}`);
    });
    const timer = window.setTimeout(() => { this.launching = false; }, 10000);
    this.register(() => window.clearTimeout(timer));
    child.unref();
  }
  onunload() {
    this.unloaded = true;
    // Disabling the plugin ends the session it started, as closing the window does.
    this.lifeline?.end();
    for (const binding of [...this.bindings]) this.release(binding);
  }
}
class Settings extends PluginSettingTab {
  constructor(
    app: App,
    readonly plugin: DotSyncPlugin,
  ) {
    super(app, plugin);
  }
  display() {
    this.containerEl.empty();
    this.daemon(new Setting(this.containerEl).setName("Daemon").setDesc("Checking…"));
    for (const [key, label, desc] of [
      ["binary", "Daemon binary", "Leave “deepika-sync” to use the daemon installed above, or the one in the PATH; or give the full path of another executable."],
      ["name", "Display name", ""],
    ] as const) {
      new Setting(this.containerEl).setName(label).setDesc(desc).addText((t) =>
        t.setValue(this.plugin.config[key]).onChange(async (value) => {
          this.plugin.config[key] = value;
          if (key === "name") for (const binding of this.plugin.bindings) binding.setName(value || "Peer");
          await this.plugin.saveData(this.plugin.config);
        }),
      );
    }
    new Setting(this.containerEl)
      .setName("Stop the session when Obsidian closes")
      .setDesc("A session started from this window ends with it, so the folder is never left shared behind your back. Turn off to keep hosting after closing Obsidian. Applies to the next session started.")
      .addToggle((t) =>
        t.setValue(this.plugin.config.stopOnClose).onChange(async (value) => {
          this.plugin.config.stopOnClose = value;
          await this.plugin.saveData(this.plugin.config);
        }),
      );
    new Setting(this.containerEl)
      .setName("Web page")
      .setDesc("Address of the deepika-sync browser client, used to build the web link of a session. Empty: no web link.")
      .addText((t) =>
        t.setPlaceholder(WEB_PAGE).setValue(this.plugin.config.webPage).onChange(async (value) => {
          this.plugin.config.webPage = value.trim();
          await this.plugin.saveData(this.plugin.config);
        }),
      );
    new Setting(this.containerEl)
      .setName("Use public Iroh relay (explicit opt-in)")
      .addToggle((t) =>
        t.setValue(this.plugin.config.relay).onChange(async (value) => {
          this.plugin.config.relay = value;
          await this.plugin.saveData(this.plugin.config);
        }),
      );
  }
  /** What runs sessions, and the button that installs or updates it. */
  private daemon(setting: Setting) {
    const plugin = this.plugin;
    const build = daemonTarget(process.platform, process.arch);
    let action = "Install";
    let button: ButtonComponent | undefined;
    if (build) setting.addButton((b) => {
      button = b.setButtonText("…").setDisabled(true).onClick(() => {
        b.setDisabled(true).setButtonText("Installing…");
        plugin.installDaemon().then(() => refresh(), (error: unknown) => {
          new Notice(`deepika-sync was not installed: ${error instanceof Error ? error.message : String(error)}`, 10000);
          b.setDisabled(false).setButtonText(action);
        });
      });
    });
    const refresh = () => {
      const binary = plugin.binary();
      void plugin.daemonVersion(binary).then((version) => {
        const desc = createFragment();
        desc.appendText(version ? `deepika-sync ${version} is installed.` : "deepika-sync is not installed: dot-sync needs it to run a session.");
        if (version && compareVersions(version, DAEMON_RELEASE) < 0) desc.appendText(` Version ${DAEMON_RELEASE} is available.`);
        if (!build) desc.appendText(` No build for this system yet (${process.platform} ${process.arch}): see ${RELEASES}.`);
        else if (plugin.customBinary()) desc.appendText(" The Daemon binary setting below takes precedence over an installed daemon.");
        if (version) desc.createDiv({ cls: "dot-sync-daemon-path", text: binary });
        setting.setDesc(desc);
        action = !version ? "Install" : compareVersions(version, DAEMON_RELEASE) < 0 ? "Update" : "Reinstall";
        button?.setButtonText(action).setDisabled(false);
        button?.buttonEl.toggleClass("mod-cta", action !== "Reinstall");
      });
    };
    refresh();
  }
}
