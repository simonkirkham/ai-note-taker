import { useEffect, useRef, useState } from "react";

export default function NoteView({
  noteId,
  initialTitle,
  onRename,
  onBack,
}: {
  noteId: string;
  initialTitle: string;
  onRename: (noteId: string, title: string) => void;
  onBack: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setTitle(initialTitle);
  }, [initialTitle]);

  return (
    <main className="container">
      <button
        data-testid="back-button"
        onClick={onBack}
        className="back-button"
      >
        ← Back
      </button>
      <input
        data-testid="note-title-input"
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => onRename(noteId, title)}
        placeholder="Note title…"
        className="title-input"
      />
    </main>
  );
}
