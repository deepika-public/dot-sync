// One shared note open in one editor: a local Y.Doc replica, its WebSocket to the
// daemon, and the y-codemirror extension that keeps the buffer and the replica equal.
// The open socket is the editor lease: while it lives the daemon leaves the file alone.
import { ChangeSet, Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { yCollab, ySyncAnnotation } from "y-codemirror.next";
import { applyToShared, reconcile } from "./merge";
import { roomName } from "./session";

/** Holds the collaboration extension of each editor; empty while a note is not shared. */
export const collab = new Compartment();

/** Changes coming from peers must not land in the local undo history: Ctrl-Z would
 *  otherwise undo a collaborator's typing. */
export const remoteOutOfHistory = EditorState.transactionExtender.of((tr) =>
  tr.annotation(ySyncAnnotation) !== undefined && tr.annotation(Transaction.addToHistory) === undefined
    ? { annotations: Transaction.addToHistory.of(false) }
    : null,
);

const COLORS = ["#b63257", "#386ac6", "#25806a", "#9861b2", "#b36b20"];
export function colorOf(name: string) {
  let h = 0;
  for (const c of name) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

export type Hooks = {
  warn: (text: string) => void;
  /** The session renamed this note; the file should follow. */
  moved: (binding: Binding, path: string) => void;
  /** The session merged this note into a twin at the same path; bind again. */
  superseded: (binding: Binding) => void;
};

export class Binding {
  readonly ydoc = new Y.Doc();
  readonly ytext = this.ydoc.getText("content");
  readonly metadata = this.ydoc.getMap<unknown>("metadata");
  readonly provider: WebsocketProvider;
  /** True once the buffer and the replica agree and y-codemirror is in charge. */
  bound = false;
  /** The session deleted this note; the buffer is kept, detached. */
  deleted = false;
  private destroyed = false;
  private readonly initial: string;
  private local: ChangeSet;

  constructor(
    readonly view: EditorView,
    public path: string,
    server: string,
    name: string,
    private readonly hooks: Hooks,
  ) {
    this.initial = view.state.doc.toString();
    this.local = ChangeSet.empty(this.initial.length);
    // No BroadcastChannel: every window must go through its own daemon connection.
    this.provider = new WebsocketProvider(server, roomName(path), this.ydoc, { disableBc: true });
    this.setName(name);
    this.provider.on("sync", (synced: boolean) => { if (synced) this.bind(); });
    this.metadata.observe(() => this.followMetadata());
  }

  get connected() { return this.provider.wsconnected; }

  setName(name: string) {
    const color = colorOf(name);
    this.provider.awareness.setLocalStateField("user", { name, color, colorLight: color + "40" });
  }

  /** The note moved locally. Reconnections must ask for the new path: the old one
   *  would make the daemon create an empty note there. */
  setPath(path: string) {
    this.path = path;
    this.provider.roomname = roomName(path);
  }

  /** The daemon restarted on another port; the provider reconnects there by itself. */
  setServer(server: string) {
    this.provider.serverUrl = server;
  }

  /** Until the first sync, remember what the user types so it can be merged. */
  update(update: ViewUpdate) {
    if (this.bound || this.destroyed) return;
    for (const tr of update.transactions) if (tr.docChanged) this.local = this.local.compose(tr.changes);
  }

  private bind() {
    if (this.bound || this.destroyed) return;
    this.followMetadata();
    if (this.deleted) return;
    const { toEditor, toShared } = reconcile(this.initial, this.local, this.ytext.toJSON());
    this.ydoc.transact(() => applyToShared(this.ytext, toShared));
    this.bound = true;
    this.view.dispatch({
      changes: toEditor,
      annotations: Transaction.addToHistory.of(false),
      effects: collab.reconfigure(yCollab(this.ytext, this.provider.awareness, { undoManager: false })),
    });
    if (this.view.state.doc.toString() !== this.ytext.toJSON()) {
      this.hooks.warn(`Could not align ${this.path} with the session; the note is left unshared.`);
      this.destroy();
    }
  }

  private followMetadata() {
    if (this.destroyed) return;
    if (this.metadata.get("deleted") === true && !this.deleted) {
      // Two peers had the same note; the session kept one identity. Same path, same
      // text: nothing was deleted, this editor just has to hold the other one.
      if (typeof this.metadata.get("superseded_by") === "string") {
        this.hooks.superseded(this);
        return;
      }
      this.deleted = true;
      this.hooks.warn(`${this.path} was deleted by a collaborator. Your buffer is kept; save it under another name to keep it.`);
      this.detach();
      return;
    }
    const path = this.metadata.get("path");
    if (typeof path === "string" && path !== this.path) this.hooks.moved(this, path);
  }

  private detach() {
    this.provider.destroy();
    if (this.bound) this.view.dispatch({ effects: collab.reconfigure([]) });
    this.bound = false;
  }

  /** Closing the socket releases the lease; the daemon then writes the merged note. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try { this.detach(); } catch { /* the view is already gone */ }
    this.ydoc.destroy();
  }
}
