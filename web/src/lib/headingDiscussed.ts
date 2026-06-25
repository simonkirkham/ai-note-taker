import type { Editor } from '@tiptap/react';

// Toggle the "discussed" strikethrough on the heading the cursor sits in.
// The ✓ tick fires this with only a caret in the heading (no text selected),
// so we must first select the heading's whole text range — a bare toggleStrike
// on a collapsed caret only sets a stored mark and leaves the text unstruck
// (BUG-37). $from.start()/end() bound the text of the parent textblock (the
// heading); toggleStrike then applies/removes strike across the whole topic.
export function markHeadingDiscussed(editor: Editor): void {
  if (!editor.isActive('heading')) return;
  const { $from } = editor.state.selection;
  const from = $from.start();
  const to = $from.end();
  editor.chain().focus().setTextSelection({ from, to }).toggleStrike().run();
}
