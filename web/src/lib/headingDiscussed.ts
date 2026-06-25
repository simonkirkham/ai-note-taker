import type { Editor } from '@tiptap/react';

// Toggle the "discussed" strikethrough on the heading the cursor sits in.
// The ✓ tick fires this with only a caret in the heading (no text selected).
export function markHeadingDiscussed(editor: Editor): void {
  editor.commands.toggleStrike();
}
