import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { emojiFor, emojifyMarkdown } from '../lib/emoji';
import { EmojiShortcode } from '../lib/emojiExtension';

describe('emojifyMarkdown (load-time transform)', () => {
  it('replaces a known shortcode with its emoji', () => {
    expect(emojifyMarkdown('Ship it :tada:')).toBe('Ship it 🎉');
  });

  it('leaves an unknown shortcode untouched', () => {
    expect(emojifyMarkdown('nope :not_a_real_code:')).toBe('nope :not_a_real_code:');
  });

  it('handles the +1 / -1 shortcodes', () => {
    expect(emojifyMarkdown(':+1: :-1:')).toBe('👍 👎');
  });

  it('does not convert a shortcode inside an inline code span', () => {
    expect(emojifyMarkdown('use `:tada:` but :fire: here')).toBe('use `:tada:` but 🔥 here');
  });

  it('does not convert a shortcode inside a fenced code block', () => {
    expect(emojifyMarkdown('```\nx = :rocket:\n```\nthen :star:')).toBe(
      '```\nx = :rocket:\n```\nthen ⭐',
    );
  });

  it('does not corrupt a shortcode-looking token inside a link URL', () => {
    expect(emojifyMarkdown('[link](https://example.com/browse/x:key:reset)')).toBe(
      '[link](https://example.com/browse/x:key:reset)',
    );
  });

  it('converts a shortcode in a link label but leaves its URL intact', () => {
    expect(emojifyMarkdown('[go :tada:](https://x.com)')).toBe('[go 🎉](https://x.com)');
  });

  it('does not corrupt a bare URL that contains a shortcode-looking token', () => {
    expect(emojifyMarkdown('See https://host/a:warning:b and :fire:')).toBe(
      'See https://host/a:warning:b and 🔥',
    );
  });

  it('leaves an image destination intact while converting its alt text', () => {
    expect(emojifyMarkdown('![alt :star:](notes/n1/abc.png "w=480")')).toBe(
      '![alt ⭐](notes/n1/abc.png "w=480")',
    );
  });

  it('does not convert a shortcode after an unterminated code fence', () => {
    expect(emojifyMarkdown('oops ```\n:tada: after')).toBe('oops ```\n:tada: after');
  });

  it('leaves prose with no shortcodes unchanged', () => {
    expect(emojifyMarkdown('a normal note: with a colon')).toBe('a normal note: with a colon');
  });

  it('emojiFor is case-insensitive and returns undefined for unknown codes', () => {
    expect(emojiFor('TADA')).toBe('🎉');
    expect(emojiFor('bogus')).toBeUndefined();
  });
});

// Simulate real char-by-char typing so the input-rule plugin's handleTextInput fires.
type TextInputHandler = (
  view: Editor['view'],
  from: number,
  to: number,
  text: string,
) => boolean;

function typeText(editor: Editor, text: string): void {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', (f) =>
      (f as unknown as TextInputHandler)(editor.view, from, to, ch),
    );
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
}

describe('EmojiShortcode input rule (live typing)', () => {
  // BUG-66: these editors dispatch transactions after construction, so each leaves a
  // prosemirror-view DOMObserver flush timer armed for 20ms. Destroying at the END of the `it`
  // body is skipped when an assertion throws, and the leaked timer then fires after vitest has
  // torn the jsdom environment down — adding a spurious `ReferenceError: document is not defined`
  // unhandled error on top of the real failure. Destroy in an afterEach so a red test stays
  // legible. (See agendaEditorApi.test.ts for the full mechanism.)
  const createdEditors: Editor[] = [];

  afterEach(() => {
    for (const editor of createdEditors) if (!editor.isDestroyed) editor.destroy();
  });

  afterAll(() => {
    expect(createdEditors).not.toHaveLength(0);
    expect(createdEditors.flatMap((e, i) => (e.isDestroyed ? [] : [i]))).toEqual([]);
  });

  function makeEditor(content = '<p></p>') {
    const editor = new Editor({ extensions: [StarterKit, Markdown, EmojiShortcode], content });
    createdEditors.push(editor);
    return editor;
  }

  it('converts a shortcode to its emoji as it is typed', () => {
    const editor = makeEditor();
    editor.commands.focus();
    typeText(editor, 'go :rocket:');
    expect(editor.getText()).toBe('go 🚀');
  });

  it('leaves an unknown shortcode as typed', () => {
    const editor = makeEditor();
    editor.commands.focus();
    typeText(editor, ':definitely_not_real:');
    expect(editor.getText()).toBe(':definitely_not_real:');
  });

  it('does not convert a shortcode typed inside inline code', () => {
    const editor = makeEditor();
    editor.chain().focus().toggleCode().run();
    typeText(editor, ':fire:');
    expect(editor.getText()).toBe(':fire:');
  });
});
