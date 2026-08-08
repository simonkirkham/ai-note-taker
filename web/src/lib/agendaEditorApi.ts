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
export interface AgendaEditorApi {
  /** Append a topic to the note's first checklist, or start one at the top if there is none. */
  addTopic(text: string): void;
  /** Tick or untick the topic at `position` (document order). */
  setTopicChecked(position: number, checked: boolean): void;
  /** Replace the text of the topic at `position`. */
  setTopicText(position: number, text: string): void;
  /** Delete the topic's line from the note. */
  removeTopic(position: number): void;
}

/** Document positions of every task item, in document order. */
function taskItemPositions(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'taskItem') positions.push(pos);
  });
  return positions;
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
    addTopic(text: string) {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Q7: the topic joins whichever checklist appears EARLIEST in the note, so a topic added
      // mid-meeting lands with the others rather than interrupting the sentence being written.
      let firstList: { pos: number; size: number } | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (!firstList && node.type.name === 'taskList') firstList = { pos, size: node.nodeSize };
        return firstList === null;
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
      // Replace the item's inline content, leaving the checkbox state untouched.
      editor
        .chain()
        .focus(undefined, quietFocus)
        .insertContentAt({ from: pos + 1, to: pos + node.nodeSize - 1 }, trimmed)
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
