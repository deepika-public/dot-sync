import { describe, it, expect } from "vitest";
import { ChangeSet, Text } from "@codemirror/state";
import * as Y from "yjs";
import { applyToShared, reconcile, replacement } from "../../src/merge";

const apply = (text: string, changes: ChangeSet) => changes.apply(Text.of(text.split("\n"))).toString();

/** Run the whole attach-time merge and return both sides. */
function merge(initial: string, typed: (length: number) => ChangeSet, remote: string) {
  const local = typed(initial.length);
  const editor = apply(initial, local);
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  ytext.insert(0, remote);
  const { toEditor, toShared } = reconcile(initial, local, remote);
  applyToShared(ytext, toShared);
  return { editor: apply(editor, toEditor), shared: ytext.toString() };
}
const nothing = (length: number) => ChangeSet.empty(length);

describe("aligning an editor with the session before binding", () => {
  it("does nothing when both already agree", () => {
    expect(replacement("same", "same")).toEqual([]);
    expect(merge("same", nothing, "same")).toEqual({ editor: "same", shared: "same" });
  });
  it("takes the session's text when only the session moved", () => {
    expect(merge("one\ntwo\n", nothing, "one\n2\ntwo\n")).toEqual({ editor: "one\n2\ntwo\n", shared: "one\n2\ntwo\n" });
  });
  it("sends what was typed before the first sync", () => {
    const typed = (length: number) => ChangeSet.of({ from: 0, insert: "typed " }, length);
    expect(merge("note", typed, "note")).toEqual({ editor: "typed note", shared: "typed note" });
  });
  it("keeps both contributions when both sides moved", () => {
    const typed = (length: number) => ChangeSet.of({ from: 0, insert: "LOCAL " }, length);
    const result = merge("start end", typed, "start middle end");
    expect(result.editor).toBe(result.shared);
    expect(result.editor).toBe("LOCAL start middle end");
  });
  it("keeps a local deletion and a remote insertion elsewhere", () => {
    const typed = (length: number) => ChangeSet.of({ from: 0, to: 4 }, length);
    const result = merge("cut keep", typed, "cut keep more");
    expect(result).toEqual({ editor: "keep more", shared: "keep more" });
  });
  it("never splits a surrogate pair", () => {
    // 😀 and 😁 share their high surrogate.
    const [change] = replacement("a😀b", "a😁b") as { from: number; to: number; insert: string }[];
    expect(change).toEqual({ from: 1, to: 3, insert: "😁" });
    expect(merge("a😀b", nothing, "a😁b")).toEqual({ editor: "a😁b", shared: "a😁b" });
    // 😀 (d83d de00) and 🤀 (d83e dd00)... end on different low surrogates; 𝐀/𝐁 share the high one too.
    expect(merge("x𝐀", nothing, "x𝐁")).toEqual({ editor: "x𝐁", shared: "x𝐁" });
  });
});
