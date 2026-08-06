import type { Editor } from '@tiptap/react';

// Prototype-only. Each variant is a RULE for reading agenda items out of a real
// Tiptap document, plus the write-backs the header strip performs. The document
// is genuinely editable in every variant — only the rule changes.

export type DerivedItem = {
  key: string;
  text: string;
  done: boolean;
  pos: number | null; // node position in the doc, when the item lives in the body
  orphan?: boolean; // text-match variant: a body row whose link has broken
};

export type VariantId = 'task' | 'heading' | 'loose' | 'match' | 'chip';

export type Variant = {
  id: VariantId;
  name: string;
  gloss: string;
  owner: 'events' | 'markdown';
  hint: string;
  chosen?: boolean;
  verdict: [string, string][];
};

export const VARIANTS: Variant[] = [
  {
    id: 'task',
    name: 'Task line',
    gloss: 'Every task list line in the body is an agenda item.',
    owner: 'markdown',
    chosen: true,
    hint: 'Type "- [] something" anywhere in the body — it becomes an agenda item as you type. Tick it in either place.',
    verdict: [
      ['good', 'No hidden token in the markdown at all. Because the body is canonical and the tick is <code>- [x]</code>, there is nothing to link — the line <em>is</em> the item.'],
      ['good', 'Works with running prose: a task line sits anywhere, no headings required.'],
      ['cost', 'The count includes every checklist line in the note, so a long note can read "3 / 20".'],
      ['cost', 'A header tick rewrites the body, so it has to merge into the unsaved draft at <code>NoteView.tsx:160</code>.'],
    ],
  },
  {
    id: 'heading',
    name: 'Linked heading',
    gloss: 'A heading marked as a topic gets a checkbox.',
    owner: 'events',
    hint: 'Click the circle beside a heading to make it a topic. Only marked headings count.',
    verdict: [
      ['good', 'Reads naturally when a note is structured as a section per topic.'],
      ['risk', 'You answered that you write running prose with few headings — there is usually no heading to mark.'],
      ['cost', 'Markdown has no attribute syntax for headings, so the mark rides as a trailing comment token.'],
    ],
  },
  {
    id: 'loose',
    name: 'Loose ✓',
    gloss: 'The floating ✓ that 43-E deleted. Pure strikethrough.',
    owner: 'markdown',
    hint: 'Put the caret in a heading and press ✓ — it strikes the text. The header agenda is a separate list.',
    verdict: [
      ['good', 'Cheapest to build — recoverable from the 43-E commit.'],
      ['risk', 'Two independent lists. Strike every heading and the header still reads 0 / 3.'],
      ['risk', 'Only fires inside a heading, so with running prose it almost never applies.'],
    ],
  },
  {
    id: 'match',
    name: 'Name match',
    gloss: 'A heading whose text equals an item is that item.',
    owner: 'events',
    hint: 'Reword either the heading or the item and watch the link break with no warning.',
    verdict: [
      ['good', 'Nothing extra stored in the markdown.'],
      ['risk', 'Rewording either side silently breaks the link — the row goes orphan.'],
      ['risk', 'Heading-anchored, so the same running-prose problem applies.'],
    ],
  },
  {
    id: 'chip',
    name: 'Inline chip',
    gloss: 'A tickable chip that sits inside the prose.',
    owner: 'events',
    hint: 'Type /agenda followed by a space to drop a chip at the caret. Click a chip to tick it.',
    verdict: [
      ['good', 'The only variant that frees a topic from the document outline entirely.'],
      ['cost', 'A custom atomic node plus a node view and a markdown serialiser — the largest editor change.'],
      ['risk', 'Degrades to a bare token in any plain-markdown view (export, the analysis prompt).'],
    ],
  },
];

export const byId = (id: VariantId) => VARIANTS.find((v) => v.id === id)!;

/* ── Reading items out of the live document ─────────────────────────── */

export function readTaskItems(editor: Editor): DerivedItem[] {
  const out: DerivedItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'taskItem') {
      out.push({
        key: `t${pos}`,
        text: node.textContent,
        done: node.attrs.checked === true,
        pos,
      });
    }
  });
  return out;
}

export function readHeadings(editor: Editor) {
  const out: { pos: number; text: string; level: number; agenda: boolean; struck: boolean }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      let struck = false;
      node.descendants((child) => {
        if (child.isText && child.marks.some((m) => m.type.name === 'strike')) struck = true;
      });
      out.push({
        pos,
        text: node.textContent,
        level: node.attrs.level ?? 2,
        agenda: node.attrs.agenda === true,
        struck,
      });
    }
  });
  return out;
}

export function readChips(editor: Editor): DerivedItem[] {
  const out: DerivedItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'agendaChip') {
      out.push({ key: `c${pos}`, text: node.attrs.text, done: node.attrs.done === true, pos });
    }
  });
  return out;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Text-match variant: pair a separate item list against the headings by wording. */
export function matchAgainstHeadings(
  editor: Editor,
  items: { key: string; text: string; done: boolean }[],
): DerivedItem[] {
  const heads = readHeadings(editor);
  return items.map((i) => {
    const h = heads.find((x) => norm(x.text) === norm(i.text));
    return { ...i, pos: h ? h.pos : null, orphan: !h };
  });
}

/* ── Write-backs (all applied as editor transactions, so ⌘Z undoes them) ── */

export function setTaskChecked(editor: Editor, pos: number, checked: boolean) {
  editor
    .chain()
    .focus(undefined, { scrollIntoView: false })
    .command(({ tr }) => {
      const node = tr.doc.nodeAt(pos);
      if (!node) return false;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });
      return true;
    })
    .run();
}

export function setHeadingAgenda(editor: Editor, pos: number, agenda: boolean) {
  editor
    .chain()
    .focus(undefined, { scrollIntoView: false })
    .command(({ tr }) => {
      const node = tr.doc.nodeAt(pos);
      if (!node) return false;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, agenda });
      return true;
    })
    .run();
}

export function setChipDone(editor: Editor, pos: number, done: boolean) {
  editor
    .chain()
    .focus(undefined, { scrollIntoView: false })
    .command(({ tr }) => {
      const node = tr.doc.nodeAt(pos);
      if (!node) return false;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, done });
      return true;
    })
    .run();
}

/** Strike the whole heading — the exact shape of the deleted markHeadingDiscussed(). */
export function toggleHeadingStrike(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const from = pos + 1;
  const to = pos + node.nodeSize - 1;
  editor
    .chain()
    .focus(undefined, { scrollIntoView: false })
    .setTextSelection({ from, to })
    .toggleStrike()
    .setTextSelection(to)
    .run();
}

export function deleteNodeAt(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor
    .chain()
    .focus(undefined, { scrollIntoView: false })
    .deleteRange({ from: pos, to: pos + node.nodeSize })
    .run();
}

export function replaceNodeText(editor: Editor, pos: number, text: string) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor
    .chain()
    .focus(undefined, { scrollIntoView: false })
    .insertContentAt({ from: pos + 1, to: pos + node.nodeSize - 1 }, text)
    .run();
}

/**
 * Q7: an item added from the header joins the note's FIRST task list; if the note
 * has none, a new list is started at the very top.
 */
export function addTaskItem(editor: Editor, text: string) {
  let first: { pos: number; size: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (!first && node.type.name === 'taskList') first = { pos, size: node.nodeSize };
    return !first;
  });

  const item = {
    type: 'taskItem',
    attrs: { checked: false },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };

  if (first) {
    const end = first.pos + first.size - 1;
    editor.chain().focus(undefined, { scrollIntoView: false }).insertContentAt(end, item).run();
  } else {
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .insertContentAt(0, { type: 'taskList', content: [item] })
      .run();
  }
}
