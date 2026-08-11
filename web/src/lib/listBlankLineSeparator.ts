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
//
// Everything below the separator is about NOT firing. This rewrites the user's stored note, so
// a false positive is worse than the bug -- it edits content that was already correct. Each
// guard encodes one CommonMark rule about when a line that looks like a list item is not one.
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

// An indented code block starts four columns past the enclosing content column, and its
// contents are literal -- a dash line inside one is text, not a list item.
const CODE_INDENT = 4;

// CommonMark HTML blocks. Types 1-5 run to a specific closer and are NOT ended by a blank line;
// types 6-7 (an ordinary tag on its own) run to the next blank line. Both kinds are raw text,
// so a dash line inside either is not a list item.
const HTML_BLOCK_CLOSERS: readonly (readonly [RegExp, string])[] = [
  [/^ {0,3}<(?:pre|script|style|textarea)(?:\s|>|$)/i, '</'],
  [/^ {0,3}<!--/, '-->'],
  [/^ {0,3}<\?/, '?>'],
  [/^ {0,3}<!\[CDATA\[/, ']]>'],
  [/^ {0,3}<![a-zA-Z]/, '>'],
];
const HTML_BLOCK_BLANK_TERMINATED = /^ {0,3}<\/?[a-zA-Z]/;

// A closer of `</` means any of the type-1 end tags; they all end the same block.
const TYPE_1_CLOSER = /<\/(?:pre|script|style|textarea)>/i;

type ListKind = 'bullet' | 'ordered' | 'task';

interface ListItemLine {
  indent: number;
  kind: ListKind;
  // The marker character (`-`, `*`, `+`, `.`, `)`). Changing it starts a NEW list in CommonMark:
  // `- a` then `* b` is already two lists, as is `1. a` then `1) b`. Only a run markdown would
  // otherwise fuse needs a separator, so the marker is part of what makes two items siblings.
  marker: string;
  // The column the item's content starts at. Everything belonging to this item is indented to
  // here, so this -- not an absolute 4 -- is what an indented code block inside the item is
  // measured from.
  contentIndent: number;
}

function isSameList(a: ListItemLine, b: ListItemLine): boolean {
  return a.indent === b.indent && a.kind === b.kind && a.marker === b.marker;
}

/**
 * Reads a line as a list item, or returns null when CommonMark would not treat it as one.
 *
 * @param openLevels the list levels currently open, outermost first.
 * @param paragraphOpen whether the previous non-blank line was ordinary paragraph text (not a
 *   list item). An item that cannot interrupt a paragraph is not an item at all: `text` then `-`
 *   is a setext H2 underline, and an ordered item must start at 1 to interrupt. The rule is
 *   about interrupting a PARAGRAPH, so it never applies between two sibling items -- `1. a`
 *   followed by `2. b` is an ordinary ordered list.
 */
function readListItem(
  line: string,
  openLevels: readonly ListItemLine[],
  paragraphOpen: boolean
): ListItemLine | null {
  if (THEMATIC_BREAK.test(line)) return null;
  const match = LIST_ITEM.exec(line);
  if (!match) return null;

  const indent = match[1].length;
  const innermost = openLevels[openLevels.length - 1];
  // Outside a list, four columns of indent is code. Inside one, the threshold is four columns
  // past the enclosing item's CONTENT column -- anything shallower is still list structure.
  const codeIndent = innermost ? innermost.contentIndent + CODE_INDENT : CODE_INDENT;
  if (indent >= codeIndent) return null;

  const marker = match[2];
  const isEmptyItem = match[3].length === 0 || BLANK.test(line.slice(match[0].length));
  if (paragraphOpen && isEmptyItem) return null;

  const contentIndent = match[0].length;
  if (/^\d/.test(marker)) {
    // Only a list starting at 1 can interrupt a paragraph.
    if (paragraphOpen && marker.slice(0, -1) !== '1') return null;
    return { indent, kind: 'ordered', marker: marker.slice(-1), contentIndent };
  }
  const rest = line.slice(match[0].length);
  return { indent, kind: TASK_MARKER.test(rest) ? 'task' : 'bullet', marker, contentIndent };
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
  // The closer that ends the HTML block currently open, or '' for a blank-line-terminated one.
  let htmlCloser: string | null = null;
  // The list levels currently open, outermost first. A blank run only separates two lists when
  // the item after it re-enters a level that is already open -- an item at a deeper indent is
  // opening a sub-list, not resuming one.
  let openLevels: ListItemLine[] = [];
  // Whether the last non-blank line was itself a list item. A blank line after a continuation
  // paragraph inside an item is that item's own spacing, not a boundary between two lists.
  let previousWasItem = false;
  // Whether the previous non-blank line was ordinary paragraph text, which narrows what the next
  // line can be read as. Set only in the non-item branch -- between two sibling items there is no
  // paragraph to interrupt.
  let paragraphOpen = false;

  const flushBlanks = (): void => {
    for (const blank of blanks) out.push(blank);
    blanks = [];
  };

  const passThrough = (line: string): void => {
    flushBlanks();
    out.push(line);
    openLevels = [];
    previousWasItem = false;
    paragraphOpen = false;
  };

  for (const line of lines) {
    if (fence !== null) {
      flushBlanks();
      out.push(line);
      const closing = FENCE.exec(line);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) fence = null;
      continue;
    }

    // A type-1..5 HTML block swallows blank lines; only its closer ends it.
    if (htmlCloser) {
      flushBlanks();
      out.push(line);
      const closed = htmlCloser === '</' ? TYPE_1_CLOSER.test(line) : line.includes(htmlCloser);
      if (closed) htmlCloser = null;
      continue;
    }

    if (BLANK.test(line)) {
      // A type-6/7 HTML block ends here; a paragraph does too.
      htmlCloser = null;
      paragraphOpen = false;
      blanks.push(line);
      continue;
    }

    if (htmlCloser === '') {
      passThrough(line);
      continue;
    }

    const htmlBlock = HTML_BLOCK_CLOSERS.find(([start]) => start.test(line));
    if (htmlBlock) {
      const [, closer] = htmlBlock;
      passThrough(line);
      const closed = closer === '</' ? TYPE_1_CLOSER.test(line) : line.includes(closer);
      if (!closed) htmlCloser = closer;
      continue;
    }

    if (HTML_BLOCK_BLANK_TERMINATED.test(line)) {
      passThrough(line);
      htmlCloser = '';
      continue;
    }

    const opening = FENCE.exec(line);
    if (opening) {
      passThrough(line);
      fence = opening[1];
      continue;
    }

    const item = readListItem(line, openLevels, paragraphOpen);
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
      paragraphOpen = false;
    } else {
      previousWasItem = false;
      paragraphOpen = true;
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

export interface MarkdownItLike {
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

export const RULE_NAME = 'listBlankLineSeparator';

/** Registers the rewrite on a markdown-it instance, at most once per instance. */
export function registerListSeparatorRule(markdownit: MarkdownItLike): void {
  if (configured.has(markdownit)) return;
  configured.add(markdownit);
  try {
    // After `normalize` (which settles line endings) and before `block` (which is what reads
    // the list markers).
    markdownit.core.ruler.after('normalize', RULE_NAME, (state) => {
      state.src = splitBlankLineSeparatedLists(state.src);
    });
  } catch {
    // `ruler.after` throws if markdown-it ever drops or renames `normalize`. This runs inside
    // the editor's parse, so throwing here would take the whole note down; falling back to no
    // separator only reinstates BUG-68, which is recoverable.
    configured.delete(markdownit);
  }
}

export const ListBlankLineSeparator = Extension.create({
  name: RULE_NAME,

  addStorage() {
    return {
      markdown: {
        parse: {
          setup: registerListSeparatorRule,
        },
      },
    };
  },
});
