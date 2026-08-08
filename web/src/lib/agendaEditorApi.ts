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
// header renders and the index a command resolves are over different sets again.
//
// The server's rule (AgendaFromContent.cs) is a per-line regex opening with `^[ \t]*`, so:
//   • NESTED items DO count, flattened into document order — AgendaFromBodySpec pins this, and
//     phase-43.md records the decision. Hence the recursion below: a top-level-only walk silently
//     dropped nested topics the user can see, which is a regression against shipped 43-F.
//   • BLOCKQUOTED lines do NOT count (a quoted checklist is someone else's agenda), so the walk
//     starts from top-level taskLists rather than every taskList in the document.
//   • EMPTY items do NOT count — the regex needs text after the bracket — so a freshly-pressed
//     item is skipped until it has content, keeping the indices aligned as the user types.
// Pre-order recursion is markdown line order, which is the order the server produces.
function collectTaskItems(
  node: ProseMirrorNode,
  base: number,
  out: { pos: number; text: string; checked: boolean }[],
): void {
  node.forEach((child, offset) => {
    if (child.type.name !== 'taskItem') return;
    const pos = base + offset;
    // textContent on the item would swallow its nested children's text too, so read the item's
    // own first paragraph.
    const text = (child.firstChild?.textContent ?? '').trim();
    if (text.length > 0) out.push({ pos, text, checked: child.attrs.checked === true });
    // Recurse into any nested taskList so its items land immediately after their parent.
    child.forEach((grandchild, childOffset) => {
      if (grandchild.type.name === 'taskList') {
        collectTaskItems(grandchild, pos + 1 + childOffset + 1, out);
      }
    });
  });
}

function topLevelTaskItems(editor: Editor): { pos: number; text: string; checked: boolean }[] {
  const items: { pos: number; text: string; checked: boolean }[] = [];
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === 'taskList') collectTaskItems(node, offset + 1, items);
  });
  return items;
}

/** Document positions of every countable task item, in document order. */
function taskItemPositions(editor: Editor): number[] {
  return topLevelTaskItems(editor).map((i) => i.pos);
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
      return topLevelTaskItems(editor).map(({ text, checked }) => ({ text, checked }));
    },

    addTopic(text: string) {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Q7: the topic joins whichever checklist appears EARLIEST in the note, so a topic added
      // mid-meeting lands with the others rather than interrupting the sentence being written.
      // Top-level only: appending into a blockquoted checklist would put the topic somewhere the
      // agenda never reads, so it would silently never appear.
      let firstList: { pos: number; size: number } | null = null;
      editor.state.doc.forEach((node, offset) => {
        if (firstList === null && node.type.name === 'taskList') {
          firstList = { pos: offset, size: node.nodeSize };
        }
      });

      const item = {
        type: 'taskItem',
        attrs: { checked: false },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: trimmed }] }],
      };

      const chain = editor.chain().focus(undefined, quietFocus);
      if (firstList) {
        const list: { pos: number; size: number } = firstList;
        chain.insertContentAt(list.pos + list.size - 1, item).run();
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
