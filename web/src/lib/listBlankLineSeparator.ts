import { Extension } from '@tiptap/core';

// BUG-68: a blank line the user left between two bullet lists disappeared the first time the
// note was opened and saved, and took the note's list spacing with it. CommonMark reads
// `- a\n- b\n\n- c` as ONE list -- a blank line between items makes the list "loose", it does
// not end it -- so the two lists merged and every item in the merged list came back
// double-spaced. The next save persisted that, so the reflow was permanent.
//
// markdown has no way to write two adjacent same-marker lists, so the boundary cannot be
// recovered at parse time from the text alone. What it *can* express is a block between them,
// and this app already has one: BUG-40's non-breaking-space line, which markdown-it keeps as
// its own paragraph (a line holding U+00A0 is not blank) and which the editor renders as the
// empty paragraph the user meant. So before markdown-it sees the source, a run of blank lines
// separating two sibling list items becomes that separator. The round trip is then stable:
// BlankLineParagraph serializes the empty paragraph straight back to a U+00A0 line.
const SEPARATOR = '\u00A0';

// A list item line: optional indent, a bullet (-, *, +) or an ordered marker (1. / 1)),
// then whitespace or end of line (`- ` on its own is a real, empty item).
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)/;

// A fence opens/closes with at least three backticks or tildes, indented at most three spaces.
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// Blank means blank to markdown: spaces and tabs only. Deliberately not `line.trim() === ''`,
// which also strips U+00A0 -- that would read BUG-40's separator paragraphs as blank lines and
// collapse them.
const BLANK = /^[ \t]*$/;

// A task item (`- [ ] x`) already parses into its own taskList node, separate from any adjacent
// bulletList, so a blank line between the two kinds needs no separator and must not get one.
const TASK_MARKER = /^\[[ xX]\]( |$)/;

// `- - -` and `* * *` are thematic breaks, not list items -- CommonMark gives the break
// precedence, and treating one as an item would wrap it in separators.
const THEMATIC_BREAK = /^ {0,3}([-*_])(?: *\1){2,} *$/;

// An HTML block runs to the next blank line, and its contents are raw -- a dash line inside one
// is not a list item.
const HTML_BLOCK_START = /^ {0,3}<\/?[a-zA-Z]/;

type ListKind = 'bullet' | 'ordered' | 'task';

interface ListItemLine {
  indent: number;
  kind: ListKind;
  // The marker character (`-`, `*`, `+`, `.`, `)`). Changing it starts a NEW list in CommonMark:
  // `- a` then `* b` is already two lists, as is `1. a` then `1) b`. Only a run markdown would
  // otherwise fuse needs a separator, so the marker is part of what makes two items siblings.
  marker: string;
}

function isSameList(a: ListItemLine, b: ListItemLine): boolean {
  return a.indent === b.indent && a.kind === b.kind && a.marker === b.marker;
}

// Reads a line as a list item, or returns null. `listOpen` matters because four spaces of
// indentation with no list open is an indented code block, whose contents are literal text.
function readListItem(line: string, listOpen: boolean): ListItemLine | null {
  if (THEMATIC_BREAK.test(line)) return null;
  const match = LIST_ITEM.exec(line);
  if (!match) return null;
  const indent = match[1].length;
  if (!listOpen && indent >= 4) return null;
  const marker = match[2];
  if (/^\d/.test(marker)) return { indent, kind: 'ordered', marker: marker.slice(-1) };
  const rest = line.slice(match[0].length);
  return { indent, kind: TASK_MARKER.test(rest) ? 'task' : 'bullet', marker };
}

/**
 * Replaces every run of blank lines that separates two sibling list items with an explicit
 * blank-line paragraph, so the two lists survive the markdown round trip as two lists.
 * Idempotent: once a separator is in place the lines either side of a blank run are no longer
 * both list items, so a second pass changes nothing.
 */
export function splitBlankLineSeparatedLists(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let blanks: string[] = [];
  let fence: string | null = null;
  let inHtmlBlock = false;
  // The list levels currently open, outermost first. A blank run only separates two lists when
  // the item after it re-enters a level that is already open -- an item at a deeper indent is
  // opening a sub-list, not resuming one.
  let openLevels: ListItemLine[] = [];
  // Whether the last non-blank line was itself a list item. A blank line after a continuation
  // paragraph inside an item is that item's own spacing, not a boundary between two lists.
  let previousWasItem = false;

  const flushBlanks = (): void => {
    out.push(...blanks);
    blanks = [];
  };

  for (const line of lines) {
    if (fence !== null) {
      flushBlanks();
      out.push(line);
      const closing = FENCE.exec(line);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) fence = null;
      continue;
    }

    if (BLANK.test(line)) {
      inHtmlBlock = false;
      blanks.push(line);
      continue;
    }

    if (inHtmlBlock || HTML_BLOCK_START.test(line)) {
      inHtmlBlock = true;
      flushBlanks();
      out.push(line);
      openLevels = [];
      previousWasItem = false;
      continue;
    }

    const opening = FENCE.exec(line);
    if (opening) {
      flushBlanks();
      out.push(line);
      fence = opening[1];
      openLevels = [];
      previousWasItem = false;
      continue;
    }

    const item = readListItem(line, openLevels.length > 0);
    const resumesOpenList =
      item !== null &&
      previousWasItem &&
      blanks.length > 0 &&
      openLevels.some((level) => isSameList(level, item));

    if (item && resumesOpenList) {
      // The blank run is a list boundary: replace it with a paragraph markdown-it cannot absorb,
      // at the items' own indent so a nested boundary stays inside its parent item.
      blanks = [];
      out.push('', `${' '.repeat(item.indent)}${SEPARATOR}`, '');
    } else {
      flushBlanks();
    }

    out.push(line);
    if (item) {
      // Any deeper level this item's own indent closes, plus a same-indent level of the other
      // kind, is no longer open.
      openLevels = openLevels.filter((level) => level.indent < item.indent);
      openLevels.push(item);
      previousWasItem = true;
    } else {
      previousWasItem = false;
      // Unindented content ends the list; indented content is an item's own continuation.
      if (!line.startsWith(' ')) openLevels = [];
    }
  }

  flushBlanks();
  return out.join('\n');
}

// The slice of markdown-it we use. tiptap-markdown bundles markdown-it without types, so the
// surface is described structurally rather than imported (which would be a phantom dependency).
interface MarkdownItCoreState {
  src: string;
}

interface MarkdownItLike {
  core: {
    ruler: {
      after: (
        afterName: string,
        ruleName: string,
        rule: (state: MarkdownItCoreState) => void
      ) => void;
    };
  };
}

// tiptap-markdown calls `parse.setup` on every parse, against the same markdown-it instance.
// Registering the rule more than once would stack duplicates on the ruler, so each instance is
// set up once.
const configured = new WeakSet<MarkdownItLike>();

export const ListBlankLineSeparator = Extension.create({
  name: 'listBlankLineSeparator',

  addStorage() {
    return {
      markdown: {
        parse: {
          setup(markdownit: MarkdownItLike) {
            if (configured.has(markdownit)) return;
            configured.add(markdownit);
            // After `normalize` (which settles line endings) and before `block` (which is what
            // reads the list markers).
            markdownit.core.ruler.after(
              'normalize',
              'listBlankLineSeparator',
              (state: MarkdownItCoreState) => {
                state.src = splitBlankLineSeparatedLists(state.src);
              }
            );
          },
        },
      },
    };
  },
});
