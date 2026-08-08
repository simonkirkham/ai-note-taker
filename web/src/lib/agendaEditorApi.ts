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

// Only TOP-LEVEL checklists count as the agenda, matching AgendaFromContent on the server, which
// deliberately skips blockquoted task lines (a quoted checklist is someone else's, not your agenda).
// Walking the whole doc instead would let a header action target a line the projection never counted
// — the index the header holds and the index the command resolves would be over different sets.
function topLevelTaskItems(editor: Editor): { pos: number; text: string; checked: boolean }[] {
  const items: { pos: number; text: string; checked: boolean }[] = [];
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name !== 'taskList') return;
    node.forEach((child, childOffset) => {
      if (child.type.name !== 'taskItem') return;
      const text = child.textContent.trim();
      // The server needs text after the bracket to call it a topic, so a freshly-pressed empty
      // item is not one. Skipping it here keeps the two indices aligned as the user types.
      if (text.length === 0) return;
      items.push({ pos: offset + 1 + childOffset, text, checked: child.attrs.checked === true });
    });
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
