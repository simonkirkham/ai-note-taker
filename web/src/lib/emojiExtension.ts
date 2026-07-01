import { Extension, InputRule } from '@tiptap/core';
import { emojiFor } from './emoji';

// Live-convert a :shortcode: to its emoji as the user finishes typing the closing
// colon. Load-time content is converted separately (emojifyMarkdown); this covers
// text typed in the editor. Unknown shortcodes are left as-is (handler returns
// null), and conversion is skipped inside inline code / code blocks so a typed
// `:tada:` in code stays literal.
export const EmojiShortcode = Extension.create({
  name: 'emojiShortcode',

  addInputRules() {
    return [
      new InputRule({
        find: /:([a-z0-9_+-]+):$/i,
        handler: ({ state, range, match, chain }) => {
          const glyph = emojiFor(match[1]);
          if (!glyph) return;

          const $from = state.doc.resolve(range.from);
          const inCodeBlock = $from.parent.type.spec.code === true;
          const codeMark = state.schema.marks.code;
          const inInlineCode =
            !!codeMark && state.doc.rangeHasMark(range.from, range.to, codeMark);
          if (inCodeBlock || inInlineCode) return;

          chain().deleteRange(range).insertContent(glyph).run();
        },
      }),
    ];
  },
});
