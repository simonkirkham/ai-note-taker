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

// A fence opens/closes with at least three backticks or tildes. Matched against the line with
// its indent stripped -- how far it may be indented is decided by the container, below.
const FENCE_BODY = /^(`{3,}|~{3,})/;

// Leading spaces. Deliberately not `trimStart()`, which also strips U+00A0 and would mis-measure
// a BUG-40 separator line as unindented.
const LEADING_SPACES = /^ */;

// Blank means blank to markdown: spaces and tabs only. Deliberately not `line.trim() === ''`,
// which also strips U+00A0 -- that would read BUG-40's separator paragraphs as blank lines and
// collapse them.
const BLANK = /^[ \t]*$/;

// A task item (`- [ ] x`) already parses into its own taskList node, separate from any adjacent
// bulletList, so a blank line between the two kinds needs no separator and must not get one.
const TASK_MARKER = /^\[[ xX]\]( |$)/;

// `- - -` and `* * *` are thematic breaks, not list items -- CommonMark gives the break
// precedence, and treating one as an item would wrap it in separators.
const THEMATIC_BREAK_BODY = /^([-*_])(?: *\1){2,} *$/;

// An indented code block starts four columns past the enclosing content column, and its
// contents are literal -- a dash line inside one is text, not a list item.
//
// This single threshold governs EVERY block start, not just code. CommonMark measures a fence
// (opening AND closing), a thematic break and an HTML block from the enclosing container's
// content column too, each allowed up to three columns of indent past it -- which is the same
// thing as "less than four". Anchoring any of them at `^ {0,3}`, or at the opening fence's own
// indent, is only correct at the top level: inside a list item it makes the scanner mis-read the
// construct and then rewrite its literal contents.
//
// Six review findings turned out to be that one cause -- a code block in an item, a padded
// marker, a fence nested in an item, a fence closed early, an empty item, and a container chosen
// by nesting depth rather than by where the line sits. So the column is derived in exactly one
// place, `containerContentColumn`, and every threshold in this file reads it from there.
const CODE_INDENT = 4;

// CommonMark HTML blocks. Types 1-5 run to a specific closer and are NOT ended by a blank line;
// types 6-7 (an ordinary tag on its own) run to the next blank line. Both kinds are raw text,
// so a dash line inside either is not a list item.
const HTML_BLOCK_CLOSERS: readonly (readonly [RegExp, string])[] = [
  [/^<(?:pre|script|style|textarea)(?:\s|>|$)/i, '</'],
  [/^<!--/, '-->'],
  [/^<\?/, '?>'],
  [/^<!\[CDATA\[/, ']]>'],
  [/^<![a-zA-Z]/, '>'],
];
const HTML_BLOCK_BLANK_TERMINATED_BODY = /^<\/?[a-zA-Z]/;

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
  // Whether the item began with nothing after its marker. CommonMark allows an item to start
  // with at most ONE blank line, so an empty item is closed by the blank line that follows it
  // and cannot contain anything after that.
  isEmpty: boolean;
}

function isSameList(a: ListItemLine, b: ListItemLine): boolean {
  return a.indent === b.indent && a.kind === b.kind && a.marker === b.marker;
}

function indentOf(line: string): number {
  return (LEADING_SPACES.exec(line) as RegExpExecArray)[0].length;
}

/**
 * The content column of the container a line at `indent` actually sits in. Every block start --
 * indented code, a fence, a thematic break, an HTML block, a nested list item -- is measured
 * from here, never from column 0.
 *
 * Which container that is depends on where the line sits, NOT on how deep the open levels go: a
 * line indented less than the innermost item's content column is not inside that item at all,
 * and CommonMark hands it back to the enclosing container. Measuring it from the innermost level
 * anyway inflates the code threshold by the difference, and the rule then rewrites lines
 * markdown-it has already put in a code block.
 */
function containerContentColumn(openLevels: readonly ListItemLine[], indent: number): number {
  for (let level = openLevels.length - 1; level >= 0; level -= 1) {
    if (openLevels[level].contentIndent <= indent) return openLevels[level].contentIndent;
  }
  return 0;
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
  codeColumn: number,
  paragraphOpen: boolean
): ListItemLine | null {
  const match = LIST_ITEM.exec(line);
  if (!match) return null;

  const indent = match[1].length;
  if (indent >= codeColumn) return null;
  // A thematic break wins over a list item, and may be indented up to three columns past the
  // container -- which the caller has already established by computing `codeColumn`.
  if (THEMATIC_BREAK_BODY.test(line.slice(indent))) return null;

  const marker = match[2];
  const isEmptyItem = match[3].length === 0 || BLANK.test(line.slice(match[0].length));
  if (paragraphOpen && isEmptyItem) return null;

  // CommonMark clamps the content column: when the marker is followed by five or more spaces
  // the item's content already IS an indented code block, so content starts at marker + 1
  // rather than where the text happens to sit. Taking the text's column instead pushes the code
  // threshold out by the same amount and reopens the hole it exists to close. An item that is
  // EMPTY clamps the same way -- and emptiness is the test, not "no spaces after the marker":
  // `-` followed by two spaces and nothing else is just as empty as `-` alone.
  const spacesAfterMarker = match[3].length;
  const contentIndent =
    spacesAfterMarker > CODE_INDENT || isEmptyItem
      ? indent + marker.length + 1
      : match[0].length;
  if (/^\d/.test(marker)) {
    // Only a list starting at 1 can interrupt a paragraph.
    if (paragraphOpen && marker.slice(0, -1) !== '1') return null;
    return { indent, kind: 'ordered', marker: marker.slice(-1), contentIndent, isEmpty: isEmptyItem };
  }
  const rest = line.slice(match[0].length);
  return {
    indent,
    kind: TASK_MARKER.test(rest) ? 'task' : 'bullet',
    marker,
    contentIndent,
    isEmpty: isEmptyItem,
  };
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

  // A block start that is not a list item. It ends the list only when it sits at column 0 --
  // indented, it is the innermost item's own content and the list stays open around it.
  const passThrough = (line: string, indent: number): void => {
    flushBlanks();
    out.push(line);
    if (indent === 0) openLevels = [];
    previousWasItem = false;
    paragraphOpen = false;
  };

  for (const line of lines) {
    if (fence !== null) {
      flushBlanks();
      out.push(line);
      const indent = indentOf(line);
      const closing = FENCE_BODY.exec(line.slice(indent));
      // CommonMark allows the closing fence up to three columns past the CONTAINER, however far
      // the opening fence itself is indented. Measuring it from the opener lets a line deeper
      // than that close the block early -- and the rest of the code then gets rewritten.
      const closerIndented = indent < containerContentColumn(openLevels, indent) + CODE_INDENT;
      if (closing && closerIndented && closing[1][0] === fence[0] && closing[1].length >= fence.length) {
        fence = null;
      }
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
      // An item may begin with at most one blank line, so this blank closes an empty item --
      // anything after it is measured from the enclosing container, not from inside the item.
      while (openLevels.length > 0 && openLevels[openLevels.length - 1].isEmpty) openLevels.pop();
      blanks.push(line);
      continue;
    }

    const indent = indentOf(line);
    const codeColumn = containerContentColumn(openLevels, indent) + CODE_INDENT;
    const body = line.slice(indent);
    // Four or more columns past the container is an indented code block: literal text, in which
    // nothing is a block start and nothing may be rewritten.
    const isLiteralCode = indent >= codeColumn;

    if (htmlCloser === '') {
      passThrough(line, indent);
      continue;
    }

    if (!isLiteralCode) {
      const htmlBlock = HTML_BLOCK_CLOSERS.find(([start]) => start.test(body));
      if (htmlBlock) {
        const [, closer] = htmlBlock;
        passThrough(line, indent);
        const closed = closer === '</' ? TYPE_1_CLOSER.test(line) : line.includes(closer);
        if (!closed) htmlCloser = closer;
        continue;
      }

      if (HTML_BLOCK_BLANK_TERMINATED_BODY.test(body)) {
        passThrough(line, indent);
        htmlCloser = '';
        continue;
      }

      const opening = FENCE_BODY.exec(body);
      if (opening) {
        passThrough(line, indent);
        fence = opening[1];
        continue;
      }
    }

    const item = isLiteralCode ? null : readListItem(line, codeColumn, paragraphOpen);
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
      // A deeply-indented line after a paragraph is a lazy continuation of it, not code -- code
      // cannot interrupt a paragraph. So it leaves an open paragraph open rather than closing
      // it; a genuine code block (nothing open beforehand) still leaves it closed.
      if (!isLiteralCode) paragraphOpen = true;
      // Unindented content ends the list; indented content is an item's own continuation.
      if (indent === 0) openLevels = [];
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
    // separator only reinstates BUG-68, which is recoverable. The instance stays in the set --
    // a retry on the next parse would throw again, and this one is done with either way.
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
