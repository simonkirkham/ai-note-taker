import { useCallback, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

interface NoteEditorProps {
  value: string;
  onChange: (md: string) => void;
  onBlur: () => void;
}

export default function NoteEditor({ value, onChange, onBlur }: NoteEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [buttonY, setButtonY] = useState<number | null>(null);

  const updateButton = useCallback((ed: Editor) => {
    if (!ed.isActive("heading") || !containerRef.current) {
      setButtonY(null);
      return;
    }
    const { from } = ed.state.selection;
    const coords = ed.view.coordsAtPos(from);
    const rect = containerRef.current.getBoundingClientRect();
    setButtonY((coords.top + coords.bottom) / 2 - rect.top);
  }, []);

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
    onUpdate: ({ editor: ed }) => {
      onChange(ed.storage.markdown.getMarkdown());
      updateButton(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => updateButton(ed),
    onFocus: ({ editor: ed }) => updateButton(ed),
    onBlur: () => {
      setButtonY(null);
      onBlur();
    },
  });

  return (
    <div ref={containerRef} className="note-editor-container">
      {buttonY !== null && editor && (
        <button
          className="discussed-button"
          style={{ top: buttonY }}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.commands.toggleStrike();
          }}
          aria-label="Mark as discussed"
        >
          ✓
        </button>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
