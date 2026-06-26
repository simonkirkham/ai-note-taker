import Paragraph from '@tiptap/extension-paragraph';

// BUG-40: note content is stored as markdown, and markdown represents a paragraph break as
// exactly one blank line -- it has no way to express an empty paragraph or several blank lines
// in a row. tiptap-markdown's default paragraph serializer therefore drops the blank lines a
// user leaves between sections, condensing the note on every save.
//
// Fix: serialize an empty paragraph as a line holding a single non-breaking space (U+00A0).
// That line survives the markdown round-trip (markdown-it keeps it as its own block), and on
// reload tiptap normalises it back to a genuinely empty paragraph -- so the user sees a real
// blank line, not a visible character, and re-saving is idempotent. Non-empty paragraphs use
// the default serializer unchanged, so ordinary content gains no stray placeholder.
//
// Caveat handled below: the placeholder is only emitted for an empty paragraph that is NOT the
// last child of its parent. A *trailing* empty paragraph is the editor's cursor affordance
// (tiptap keeps one after a list/blockquote/etc so you can place the caret past the block), not
// user-intended structure -- emitting a placeholder there would persist a stray U+00A0 after
// such notes, and would turn a fully-cleared note into a `\u00A0` body instead of an empty one.
// Trailing blank lines are insignificant in markdown anyway, so dropping them matches norms.
const EMPTY_PARAGRAPH_PLACEHOLDER = '\u00A0';

// The slice of prosemirror-markdown's MarkdownSerializerState we use. tiptap-markdown is plain
// JS with no exported TS types, so we describe the surface structurally rather than import it
// (which would be a phantom dependency).
interface SerializerState {
  write: (text: string) => void;
  closeBlock: (node: unknown) => void;
  renderInline: (node: unknown) => void;
}

interface ParentNode {
  childCount: number;
}

// Drop-in replacement for StarterKit's bundled Paragraph (registered via
// `StarterKit.configure({ paragraph: false })` + this extension). Only the markdown
// serialization is overridden; all paragraph behaviour, commands, and shortcuts are inherited.
// `parse` is intentionally left to tiptap-markdown's default (markdown-it) -- getMarkdownSpec
// merges this storage over the default, so we only customise the serialize direction.
export const BlankLineParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: SerializerState,
          node: { content: { size: number } },
          parent: ParentNode | undefined,
          index: number
        ) {
          const isLastChild = parent ? index === parent.childCount - 1 : true;
          if (node.content.size === 0 && !isLastChild) {
            state.write(EMPTY_PARAGRAPH_PLACEHOLDER);
            state.closeBlock(node);
            return;
          }
          state.renderInline(node);
          state.closeBlock(node);
        },
      },
    };
  },
});
