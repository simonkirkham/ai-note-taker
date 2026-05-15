import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

interface NoteEditorProps {
  value: string;
  onChange: (md: string) => void;
  onBlur: () => void;
}

export default function NoteEditor({ value, onChange, onBlur }: NoteEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Markdown],
    content: value,
    editorProps: {
      attributes: {
        "aria-label": "Note content",
        "data-testid": "note-content",
        class: "content-input",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.storage.markdown.getMarkdown());
    },
    onBlur,
  });

  return <EditorContent editor={editor} />;
}
