import { Heading } from '@tiptap/extension-heading';
import { Node, mergeAttributes } from '@tiptap/core';

// Prototype-only extensions. Both exist purely so the "Linked heading" and
// "Inline chip" variants behave for real in the editor rather than being mocked.

/**
 * Linked-heading variant: a boolean `agenda` attribute on the heading node.
 * Markdown has no attribute syntax for headings, so on serialize this rides as a
 * trailing `<!--a-->` comment token — which is exactly the cost that variant carries.
 */
export const AgendaHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      agenda: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-agenda') === 'true',
        renderHTML: (attrs) => (attrs.agenda ? { 'data-agenda': 'true' } : {}),
      },
    };
  },
});

/**
 * Inline-chip variant: an atomic inline node carrying its own text and ticked state.
 * Clicking it toggles. Serialises to a token, since a chip has no markdown equivalent.
 */
export const AgendaChip = Node.create({
  name: 'agendaChip',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      text: { default: 'topic' },
      done: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-agenda-chip]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-agenda-chip': 'true',
        'data-done': node.attrs.done ? 'true' : 'false',
        class: 'protoChip',
      }),
      `${node.attrs.done ? '✓' : '○'} ${node.attrs.text}`,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void }, node: { attrs: { done: boolean; text: string } }) {
          state.write(`[${node.attrs.done ? 'x' : ' '}] ${node.attrs.text} <!--chip-->`);
        },
        parse: {},
      },
    };
  },

  addInputRules() {
    return [
      {
        find: /\/agenda\s$/,
        handler: ({ range, chain }) => {
          chain()
            .deleteRange(range)
            .insertContent({ type: this.name, attrs: { text: 'new topic', done: false } })
            .run();
        },
      },
    ];
  },
});
