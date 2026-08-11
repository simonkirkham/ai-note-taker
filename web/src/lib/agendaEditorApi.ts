import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';

// Phase 43-G — the header agenda strip writes back into the note body.
//
// Since 43-F a topic IS a task-list line in the note, so "add a topic" means "insert a task item"
// and "tick a topic" means "toggle that line's checkbox". Those are document edits, not API calls:
// running them as editor transactions means Ctrl+Z undoes them like any other typing, and the
// change rides the existing content-save path instead of racing it.
//
// The critical property is that every command operates on the editor's CURRENT document, which
// already reflects unsaved typing (NoteView keeps it in contentDraft). Writing detail.content back
// instead would silently discard whatever the user had typed and not yet saved.
//
// Topics are addressed by POSITION — the index of the task item in document order, which is exactly
// what NoteDetailView.Agenda's Position carries for a derived topic. That keeps this seam free of
// Tiptap types at the call site: AgendaSection passes a number, never a node or an editor.
/** A topic as it exists in the note RIGHT NOW, read straight from the editor document. */
export interface LiveTopic {
  text: string;
  checked: boolean;
}

export interface AgendaEditorApi {
  /** Topics in the live document, in document order. Index === the position commands take. */
  readTopics(): LiveTopic[];
  /** Append a topic to the note's first checklist, or start one at the top if there is none. */
  addTopic(text: string): void;
  /** Tick or untick the topic at `position` (document order). */
  setTopicChecked(position: number, checked: boolean): void;
  /** Replace the text of the topic at `position`. */
  setTopicText(position: number, text: string): void;
  /** Delete the topic's line from the note. */
  removeTopic(position: number): void;
}

// What counts as a topic must match AgendaFromContent on the server EXACTLY, or the index the
// header renders and the index a command resolves are over different sets again — and since 43-H2
// made the body the only source, a line the server counts and this walk misses is a topic the user
// can neither see in the header nor tick from it, while the "X / Y" pill still counts it.
//
// That equivalence is pinned as a SHARED fixture rather than as assertions on one side:
// web/src/__tests__/fixtures/agenda-parity.json is asserted by this walk (agendaParity.test.ts)
// AND by AgendaFromContent.Parse (AgendaParityFixtureSpec), so changing either reading alone turns
// the other side red.
//
// The server's rule (AgendaFromContent.cs) is a per-line regex opening with `^[ \t]*`, so:
//   • NESTED items DO count, flattened into document order — AgendaFromBodySpec pins this, and
//     phase-43.md records the decision. Hence the recursion below.
//   • It does not care what the line is nested UNDER. Indenting a checklist beneath a plain bullet
//     or a numbered item is ordinary note-taking, and the server counts every one of those lines,
//     so the descent covers every LIST type — not taskList alone (BUG-76). A taskList-only walk
//     returned nothing at all for `- Shopping` / `  - [ ] Milk`: the entire agenda disappeared
//     from the header while the pill went on counting it.
//   • BLOCKQUOTED lines do NOT count (a quoted checklist is someone else's agenda). A blockquote is
//     not a list and is not in the descent set, so widening to list types cannot reintroduce them.
//   • EMPTY items do NOT count — the regex needs text after the bracket — so a freshly-pressed
//     item is skipped until it has content, keeping the indices aligned as the user types.
// Pre-order recursion is markdown line order, which is the order the server produces.
const LIST_NODES = new Set(['taskList', 'bulletList', 'orderedList']);
const LIST_ITEM_NODES = new Set(['taskItem', 'listItem']);

/** A countable topic plus the document position its commands address. */
interface CountedTopic {
  pos: number;
  text: string;
  checked: boolean;
}

// A list container or a list item — the only nodes whose children can hold a countable line.
// Paragraphs, blockquotes, tables and code blocks all stop the descent.
function isListStructure(node: ProseMirrorNode): boolean {
  return LIST_NODES.has(node.type.name) || LIST_ITEM_NODES.has(node.type.name);
}

function collectTaskItems(node: ProseMirrorNode, base: number, out: CountedTopic[]): void {
  node.forEach((child, offset) => {
    const pos = base + offset;
    if (child.type.name === 'taskItem') {
      // textContent on the item would swallow its nested children's text too, so read the item's
      // own first paragraph.
      const text = (child.firstChild?.textContent ?? '').trim();
      if (text.length > 0) out.push({ pos, text, checked: child.attrs.checked === true });
    }
    // Descend through every list container AND list item, so a checklist reachable through a list
    // of any kind lands immediately after its parent — the order the server's line scan produces.
    if (isListStructure(child)) collectTaskItems(child, pos + 1, out);
  });
}

function countableTaskItems(editor: Editor): CountedTopic[] {
  const items: CountedTopic[] = [];
  editor.state.doc.forEach((node, offset) => {
    if (LIST_NODES.has(node.type.name)) collectTaskItems(node, offset + 1, items);
  });
  return items;
}

// The first checklist the walk above REACHES, in document order — which since BUG-76 may be one
// nested inside another list. A blockquoted checklist is still never returned: the walk does not
// enter a blockquote, so a topic added there would land somewhere the agenda never reads and would
// silently never appear.
//
// KNOWN WRONG in one case — filed as BUG-80. "Reaches" is not "reads a topic from", and the two
// come apart when tiptap-markdown parses a stray EMPTY top-level taskList ahead of the real
// content, as it does for `- Shopping` / `  - [ ] Milk` / `- [ ] Bread`. This returns that empty
// list, so a topic added from the header lands in an invisible checklist at the top of the note.
// Parity is unaffected — the header and the server still agree on the count, and no command
// addresses the wrong line — which is why it is filed rather than fixed here. The fix is to prefer
// a taskList that yields a countable topic, falling back to the first only when none does.
function firstReadableTaskList(editor: Editor): { pos: number; size: number } | null {
  const found: { pos: number; size: number }[] = [];
  const visit = (node: ProseMirrorNode, base: number): void => {
    node.forEach((child, offset) => {
      if (found.length > 0) return;
      const pos = base + offset;
      if (child.type.name === 'taskList') {
        found.push({ pos, size: child.nodeSize });
        return;
      }
      if (isListStructure(child)) visit(child, pos + 1);
    });
  };
  visit(editor.state.doc, 0);
  return found[0] ?? null;
}

/** Document positions of every countable task item, in document order. */
function taskItemPositions(editor: Editor): number[] {
  return countableTaskItems(editor).map((i) => i.pos);
}

function nodePosAt(editor: Editor, position: number): number | null {
  const positions = taskItemPositions(editor);
  return position >= 0 && position < positions.length ? positions[position] : null;
}

// Every command focuses without scrolling: adding a topic from the header must not yank the
// viewport away from what the user is typing, and must not move their cursor.
const quietFocus = { scrollIntoView: false } as const;

export function createAgendaEditorApi(editor: Editor): AgendaEditorApi {
  return {
    readTopics(): LiveTopic[] {
      return countableTaskItems(editor).map(({ text, checked }) => ({ text, checked }));
    },

    addTopic(text: string) {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Q7: the topic joins whichever checklist appears EARLIEST in the note, so a topic added
      // mid-meeting lands with the others rather than interrupting the sentence being written.
      // BUG-76: "earliest" means the first checklist the READ walk reaches, so a note whose only
      // checklist is indented under a bullet gets the new topic in that list — the one the header
      // is showing — instead of a second list above it.
      const firstList = firstReadableTaskList(editor);

      const item = {
        type: 'taskItem',
        attrs: { checked: false },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: trimmed }] }],
      };

      const chain = editor.chain().focus(undefined, quietFocus);
      if (firstList) {
        chain.insertContentAt(firstList.pos + firstList.size - 1, item).run();
      } else {
        chain.insertContentAt(0, { type: 'taskList', content: [item] }).run();
      }
    },

    setTopicChecked(position: number, checked: boolean) {
      const pos = nodePosAt(editor, position);
      if (pos === null) return;
      editor
        .chain()
        .focus(undefined, quietFocus)
        .command(({ tr }) => {
          const node = tr.doc.nodeAt(pos);
          if (!node) return false;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });
          return true;
        })
        .run();
    },

    setTopicText(position: number, text: string) {
      const trimmed = text.trim();
      const pos = nodePosAt(editor, position);
      if (pos === null || !trimmed) return;
      const node = editor.state.doc.nodeAt(pos);
      if (!node) return;
      // Replace ONLY the item's first paragraph: with nested task items the node also contains a
      // child taskList, and those children are topics in their own right. Insert a text NODE, not a
      // string — a string is parsed as HTML, so "Q3 <projects> review" would silently lose the tag.
      const paragraph = node.firstChild;
      if (!paragraph) return;
      const from = pos + 1;
      editor
        .chain()
        .focus(undefined, quietFocus)
        .insertContentAt(
          { from: from + 1, to: from + paragraph.nodeSize - 1 },
          { type: 'text', text: trimmed },
        )
        .run();
    },

    removeTopic(position: number) {
      const pos = nodePosAt(editor, position);
      if (pos === null) return;
      const node = editor.state.doc.nodeAt(pos);
      if (!node) return;
      editor
        .chain()
        .focus(undefined, quietFocus)
        .deleteRange({ from: pos, to: pos + node.nodeSize })
        .run();
    },
  };
}
