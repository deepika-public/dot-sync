// Bringing an editor buffer and a freshly synced Y.Text together, once, before
// y-codemirror takes over. Both started from the text the editor held when it was
// attached; each side may have moved since. CodeMirror change sets already know how
// to transform concurrent changes, so nothing is lost on either side.
import { ChangeSet, ChangeSpec } from "@codemirror/state";
import type * as Y from "yjs";

/** The single replacement turning `old` into `text`, trimmed to what differs. */
export function replacement(old: string, text: string): ChangeSpec[] {
  if (old === text) return [];
  let start = 0;
  const limit = Math.min(old.length, text.length);
  while (start < limit && old[start] === text[start]) start++;
  let endOld = old.length, endNew = text.length;
  while (endOld > start && endNew > start && old[endOld - 1] === text[endNew - 1]) { endOld--; endNew--; }
  // Never cut a surrogate pair in two.
  const low = (s: string, i: number) => i > 0 && i < s.length && s.charCodeAt(i) >= 0xdc00 && s.charCodeAt(i) <= 0xdfff;
  if (low(old, start) || low(text, start)) start--;
  if (low(old, endOld) || low(text, endNew)) { endOld++; endNew++; }
  return [{ from: start, to: endOld, insert: text.slice(start, endNew) }];
}

/** `local`: what the user typed since `initial`. `remoteText`: what the session holds.
 *  Returns the changes each side still needs, so both end on the same text. */
export function reconcile(initial: string, local: ChangeSet, remoteText: string) {
  const remote = ChangeSet.of(replacement(initial, remoteText), initial.length);
  return { toEditor: remote.map(local), toShared: local.map(remote, true) };
}

/** Apply CodeMirror changes to a Y.Text. Both index text in UTF-16 units. */
export function applyToShared(ytext: Y.Text, changes: ChangeSet) {
  changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
    if (toA > fromA) ytext.delete(fromB, toA - fromA);
    if (inserted.length) ytext.insert(fromB, inserted.toString());
  });
}
