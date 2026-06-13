import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';
import ImageNodeView from './ImageNodeView';

// Minimal shape of the prosemirror-markdown serializer state tiptap-markdown hands
// our `serialize`. Typed locally to avoid a direct prosemirror-markdown dependency.
interface MarkdownState {
  write(text: string): void;
  esc(text: string): string;
}

interface ImageAttrs {
  src?: string;
  alt?: string;
  title?: string;
  width?: number | null;
}

// The title slot is owned by the width convention here (decorative note images
// carry no real title). `WIDTH_VALUE` parses a well-formed width; `WIDTH_TOKEN`
// matches any `w=…` so a malformed token is stripped (not shown as a tooltip).
const WIDTH_VALUE = /^w=(\d+)$/;
const WIDTH_TOKEN = /^w=/;

// Image extended with:
//  - a React NodeView (inline remove control + size control),
//  - a `width` attribute persisted in the markdown *title slot* as `"w=<px>"`.
//
// Wire format (a) from the phase doc: the width rides the existing title slot, so
// `noteImages`' key<->URL rewrite (which already preserves the title byte-for-byte)
// transports it for free — only this node's markdown serialize and attribute parse
// need teaching. The title slot is overloaded semantically; `width` parses out of
// it and `title` strips it so the token never shows as a real tooltip.
export const ImageWithResize = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },

  addAttributes() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const attr = el.getAttribute('width');
          if (attr && /^\d+$/.test(attr)) return parseInt(attr, 10);
          const m = (el.getAttribute('title') ?? '').match(WIDTH_VALUE);
          return m ? parseInt(m[1], 10) : null;
        },
        renderHTML: (attrs: ImageAttrs) =>
          attrs.width
            ? { width: String(attrs.width), style: `width: ${attrs.width}px; max-width: 100%;` }
            : {},
      },
      title: {
        ...(parent as { title?: object }).title,
        default: null,
        // Keep the width token out of the visible title (it would render as a tooltip).
        parseHTML: (el: HTMLElement) => {
          const t = el.getAttribute('title');
          return t && WIDTH_TOKEN.test(t) ? null : t;
        },
      },
    };
  },

  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: MarkdownState, node: { attrs: ImageAttrs }) {
          const { src = '', alt, width, title } = node.attrs;
          const titleText = width ? `w=${width}` : (title ?? '');
          const titlePart = titleText ? ` "${titleText.replace(/"/g, '\\"')}"` : '';
          state.write(`![${state.esc(alt ?? '')}](${src.replace(/[()]/g, '\\$&')}${titlePart})`);
        },
        parse: {}, // image parse rides markdown-it core + the node's parseHTML
      },
    };
  },
});
