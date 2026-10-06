import { App, FuzzySuggestModal, TFolder, Modal, Setting, Notice } from "obsidian";
import { JoinPlan, leavesFolderUntouched, webLink } from "./session";

export class ShareInvitation extends Modal {
  constructor(app: App, readonly invite: string, readonly webPage: string) { super(app); }
  onOpen() {
    this.titleEl.setText("Session invitation");
    this.contentEl.createEl("p", { text: "Send this invitation privately. Your collaborator chooses join dot-sync session in this folder and pastes it." });
    const input = this.contentEl.createEl("textarea", { cls: "dot-sync-invitation" });
    input.value = this.invite;
    input.readOnly = true;
    input.addEventListener("focus", () => input.select());
    new Setting(this.contentEl).addButton(button => button.setButtonText("Copy invitation").setCta().onClick(() => {
      void navigator.clipboard.writeText(this.invite).then(() => new Notice("Invitation copied"))
        .catch(() => new Notice("Select the invitation and copy it manually."));
    }));
    this.contentEl.createEl("h4", { text: "Or join from a browser" });
    const link = webLink(this.webPage, this.invite);
    if ("unavailable" in link) { this.contentEl.createEl("p", { cls: "dot-sync-web-link-unavailable", text: link.unavailable }); return; }
    this.contentEl.createEl("p", { text: "Nothing to install: whoever opens this link edits the folder from a web page. It contains the invitation, so send it privately too." });
    const url = this.contentEl.createEl("input", { cls: "dot-sync-web-link", type: "text" });
    url.value = link.url;
    url.readOnly = true;
    url.addEventListener("focus", () => url.select());
    new Setting(this.contentEl).addButton(button => button.setButtonText("Copy web link").onClick(() => {
      void navigator.clipboard.writeText(link.url).then(() => new Notice("Web link copied"))
        .catch(() => new Notice("Select the link and copy it manually."));
    }));
  }
}

/** Shown before joining: what the folder is about to go through. Nothing has been
 *  written yet; refusing leaves the folder exactly as it is. */
export class JoinPreview extends Modal {
  private decided = false;
  constructor(app: App, readonly folder: string, readonly plan: JoinPlan | Error,
    readonly decide: (accepted: boolean) => void) { super(app); }
  onOpen() {
    this.titleEl.setText("Join this session?");
    this.modalEl.addClass("dot-sync-join-preview");
    const plan = this.plan;
    if (plan instanceof Error) {
      this.contentEl.createEl("p", { text: `The session could not be inspected, so the changes to “${this.folder}” cannot be shown.` });
      this.contentEl.createEl("p", { cls: "dot-sync-preview-error", text: plan.message });
      this.contentEl.createEl("p", { text: "Check that the person who invited you is online, then try again. Nothing has been changed." });
    } else {
      this.contentEl.createEl("p", { text: `The session holds ${plan.session_documents} note(s). Joining will change “${this.folder}” as follows. Nothing has been changed yet.` });
      this.section("New files created in this folder", plan.create);
      this.section("Same name, different content — both versions are kept, one as “name (conflit …).md”", plan.conflict);
      this.section("Files merged with the session's version", plan.update);
      this.section("Files renamed", plan.rename.map((r) => `${r.from} → ${r.to}`));
      this.section("Files DELETED, because the session deleted them", plan.delete, "dot-sync-preview-danger");
      this.section("Your notes sent to every participant (unchanged here)", plan.share);
      if (plan.identical) this.contentEl.createEl("p", { text: `${plan.identical} note(s) are already identical: nothing to do.` });
      if (leavesFolderUntouched(plan)) this.contentEl.createEl("p", { cls: "dot-sync-preview-calm", text: "No file of this folder will be modified." });
    }
    const buttons = new Setting(this.contentEl);
    buttons.addButton((b) => b.setButtonText("Refuse").onClick(() => this.finish(false)));
    if (!(plan instanceof Error)) buttons.addButton((b) => b.setButtonText("Accept and join").setCta().onClick(() => this.finish(true)));
  }
  private section(title: string, lines: string[], cls = "") {
    if (!lines.length) return;
    this.contentEl.createEl("h4", { text: `${title} (${lines.length})`, cls });
    const list = this.contentEl.createEl("ul", { cls: "dot-sync-preview-list" });
    for (const line of lines) list.createEl("li", { text: line });
  }
  private finish(accepted: boolean) {
    this.decided = true;
    this.close();
    this.decide(accepted);
  }
  // Closing the window any other way is a refusal.
  onClose() { if (!this.decided) this.decide(false); }
}

export class FolderPicker extends FuzzySuggestModal<TFolder> {
  constructor(app: App, readonly choose: (folder: TFolder) => void) {
    super(app);
    this.setPlaceholder("Choose the folder to collaborate on");
  }
  getItems() {
    return [this.app.vault.getRoot(), ...this.app.vault.getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder && !file.isRoot())]
      .filter(folder => folder.isRoot() || folder.path.split("/").every(part => !part.startsWith(".")));
  }
  getItemText(folder: TFolder) {
    return folder.isRoot() ? `${this.app.vault.getName()} (entire vault)` : folder.path;
  }
  onChooseItem(folder: TFolder) { this.choose(folder); }
}

// Obsidian has no public API for decorating file-explorer folder rows.
// This optional decoration never participates in session or document ownership.
export class FolderBadge {
  private path?: string;
  private text = "";
  private observer: MutationObserver;
  constructor(private readonly container: HTMLElement) {
    this.observer = new MutationObserver(() => this.paint());
    this.observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-path"] });
  }
  update(path: string | undefined, text: string) {
    this.path = path;
    this.text = text;
    this.paint();
  }
  private paint() {
    for (const row of Array.from(this.container.querySelectorAll<HTMLElement>(
      '.nav-folder-title, .workspace-leaf-content[data-type="file-explorer"] .nav-header',
    ))) {
      const selected = this.path === "/" ? row.matches(".nav-header")
        : this.path !== undefined && row.dataset.path === this.path;
      const badge = row.querySelector<HTMLElement>(":scope > .dot-sync-folder-badge");
      if (!selected) { badge?.remove(); continue; }
      const element = badge ?? createSpan();
      element.className = "dot-sync-folder-badge";
      const text = this.path === "/" ? `dot-sync · ${this.text}` : this.text;
      if (element.textContent !== text) element.textContent = text;
      element.title = `dot-sync · ${this.text}`;
      if (!badge) row.append(element);
    }
  }
  destroy() {
    this.observer.disconnect();
    for (const badge of Array.from(this.container.querySelectorAll(".dot-sync-folder-badge"))) badge.remove();
  }
}
