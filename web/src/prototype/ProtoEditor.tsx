import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useState, useRef } from "react";

const SAMPLE = `## Budget review

Some notes about the budget discussion.

## Hiring plan

- 2 senior engineers
- 1 junior engineer

Regular paragraph below the list.

## Q3 goals

High-level priorities for the quarter.`;

export function ProtoEditor() {
  const [savedMd, setSavedMd] = useState(SAMPLE);
  const containerRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: SAMPLE,
    onBlur({ editor }) {
      try {
        setSavedMd(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(editor.storage as any).markdown.getMarkdown());
      } catch {
        setSavedMd(editor.getHTML());
      }
    },
  });

  // Derive heading state from editor on every selection change
  const { inHeading, isDiscussed, buttonTop } = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor) return { inHeading: false, isDiscussed: false, buttonTop: 0 };
      const inH = editor.isActive("heading");
      let buttonTop = 0;
      if (inH && containerRef.current) {
        const { from } = editor.state.selection;
        try {
          const coords = editor.view.coordsAtPos(from);
          const containerRect = containerRef.current.getBoundingClientRect();
          buttonTop = coords.top - containerRect.top + containerRef.current.scrollTop - 2;
        } catch {
          // ignore positioning errors
        }
      }
      return {
        inHeading: inH,
        isDiscussed: inH && editor.isActive("strike"),
        buttonTop,
      };
    },
  });

  function toggleDiscussed() {
    if (!editor) return;
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type.name === "heading") {
        const start = $from.start(d);
        const end = $from.end(d);
        editor
          .chain()
          .focus()
          .setTextSelection({ from: start, to: end })
          .toggleStrike()
          .run();
        try {
          setSavedMd(// eslint-disable-next-line @typescript-eslint/no-explicit-any
(editor.storage as any).markdown.getMarkdown());
        } catch {
          setSavedMd(editor.getHTML());
        }
        break;
      }
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "40px auto", fontFamily: "'Inter', system-ui", color: "#134E4A" }}>
      <p style={{ fontSize: 12, color: "#64748B", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>
        Phase 7 prototype · focus: mark-as-discussed button
      </p>
      <p style={{ fontSize: 13, color: "#94A3B8", marginBottom: 24 }}>
        Click into a heading. Type <code>## </code> for a heading, <code>- </code> for bullets, Ctrl+B for bold.
      </p>

      <style>{`
        .proto-editor h1::before { content: "# ";   color: #94A3B8; font-weight: 400; }
        .proto-editor h2::before { content: "## ";  color: #94A3B8; font-weight: 400; }
        .proto-editor h3::before { content: "### "; color: #94A3B8; font-weight: 400; }
      `}</style>

      {/* Editor + floating button wrapper */}
      <div style={{ position: "relative" }} ref={containerRef}>
        {/* Floating ✓ button — tracks the active heading's vertical position */}
        <div
          style={{
            position: "absolute",
            right: -160,
            top: buttonTop,
            opacity: inHeading ? 1 : 0,
            pointerEvents: inHeading ? "auto" : "none",
            transition: "opacity 0.12s ease, top 0.08s ease",
            zIndex: 10,
          }}
        >
          <button
            onMouseDown={(e) => {
              e.preventDefault(); // prevent editor blur before toggle fires
              toggleDiscussed();
            }}
            style={{
              padding: "4px 12px",
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 4,
              border: `1px solid ${isDiscussed ? "#0D9488" : "#CCEBE8"}`,
              background: isDiscussed ? "#CCFBF1" : "#F0FDFA",
              color: isDiscussed ? "#0F766E" : "#64748B",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              whiteSpace: "nowrap",
              boxShadow: "0 1px 4px rgba(0,0,0,0.10)",
              transition: "all 0.15s ease",
            }}
          >
            ✓ {isDiscussed ? "Discussed" : "Mark as discussed"}
          </button>
        </div>

        {/* Editor */}
        <div
          className="proto-editor"
          style={{
            border: "1px solid #CCEBE8",
            borderRadius: 6,
            padding: "12px 16px",
            minHeight: 300,
            background: "#fff",
            cursor: "text",
          }}
          onClick={() => editor?.commands.focus()}
        >
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Live markdown output */}
      <details style={{ marginTop: 20 }}>
        <summary style={{ fontSize: 12, color: "#64748B", cursor: "pointer", userSelect: "none" }}>
          Saved markdown (persisted on blur)
        </summary>
        <pre
          style={{
            marginTop: 8,
            background: "#F8FAFC",
            border: "1px solid #E2E8F0",
            padding: 12,
            borderRadius: 4,
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "#334155",
          }}
        >
          {savedMd}
        </pre>
      </details>
    </div>
  );
}
