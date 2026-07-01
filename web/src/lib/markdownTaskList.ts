import { TaskList } from '@tiptap/extension-task-list';

// tiptap-markdown serialises a taskList "loose" — a blank line between every item —
// because (unlike bulletList) the taskList node carries no `tight` attr, so its
// renderList falls back to loose. Since onUpdate re-serialises the whole doc on any
// edit, that silently double-spaces every checklist in a note the first time it is
// touched. Give the node a `tight` attr defaulting true (not rendered to the DOM)
// so tiptap-markdown's existing serializer emits a tight list — matching how
// bulletList already round-trips. Serializer/parser are otherwise untouched.
export const MarkdownTaskList = TaskList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tight: {
        default: true,
        rendered: false,
        keepOnSplit: false,
      },
    };
  },
});
