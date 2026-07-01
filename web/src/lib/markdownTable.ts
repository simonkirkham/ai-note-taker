import { Table } from '@tiptap/extension-table';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

// tiptap-markdown's built-in table serializer emits every column separator as a
// bare `---`, dropping the GFM alignment markers (`:---`, `:---:`, `---:`) even
// though the parsed cells carry an `align` attr. Because onUpdate re-serialises
// the whole doc on any edit, that silently strips alignment from a note's tables
// the first time the user touches the note. We override only the `serialize` half
// of the table markdown spec; tiptap-markdown merges it over its default spec, so
// the default parser (markdown → table nodes) is untouched.

// prosemirror-markdown's MarkdownSerializerState — typed loosely to the members we
// use. `out` is its public string accumulator; renderInline appends to it.
interface SerializerState {
  out: string;
  write(content: string): void;
  ensureNewLine(): void;
  closeBlock(node: ProseMirrorNode): void;
  renderInline(node: ProseMirrorNode): void;
}

function alignMarker(align: unknown): string {
  switch (align) {
    case 'left':
      return ':---';
    case 'center':
      return ':---:';
    case 'right':
      return '---:';
    default:
      return '---';
  }
}

// Render a single cell's inline content to a string by snapshotting the shared
// output buffer around renderInline, then rolling it back. A cell may hold more
// than one block (paragraph); join those with a space. Escape pipes and flatten
// newlines so a cell never breaks the one-row-per-line table grammar.
function cellToText(state: SerializerState, cell: ProseMirrorNode): string {
  const start = state.out.length;
  cell.forEach((block, _offset, index) => {
    if (index > 0) state.out += ' ';
    state.renderInline(block);
  });
  const text = state.out.slice(start);
  state.out = state.out.slice(0, start);
  return text.replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim();
}

function serializeTable(state: SerializerState, node: ProseMirrorNode): void {
  const rows: string[][] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cellToText(state, cell)));
    rows.push(cells);
  });
  if (rows.length === 0) return;

  const aligns: string[] = [];
  node.firstChild?.forEach((cell) => aligns.push(alignMarker(cell.attrs.align)));

  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  state.write(line(rows[0]));
  state.ensureNewLine();
  state.write(line(aligns));
  state.ensureNewLine();
  for (let i = 1; i < rows.length; i += 1) {
    state.write(line(rows[i]));
    state.ensureNewLine();
  }
  state.closeBlock(node);
}

export const MarkdownTable = Table.extend({
  addStorage() {
    const parent = (this.parent?.() ?? {}) as Record<string, unknown>;
    return {
      ...parent,
      markdown: {
        serialize: serializeTable,
      },
    };
  },
});
