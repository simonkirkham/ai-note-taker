import { useState } from "react";
import { FolderNode, NoteItem } from "../api";
import FolderTree from "./FolderTree";

export default function Sidebar({
  notes: _notes,
  activeNoteId: _activeNoteId,
  open,
  onSelect: _onSelect,
  onCreate,
  folders,
  activeFolderId,
  onFolderSelect,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onCreateChildFolder,
  onDropNote,
  onHome,
  onUnfiledSelect,
  isUnfiledActive,
  onDropToUnfiled,
  onPreview,
}: {
  notes: NoteItem[];
  activeNoteId?: string;
  open?: boolean;
  onSelect: (noteId: string) => void;
  onCreate: () => void;
  folders: FolderNode[];
  activeFolderId?: string;
  onFolderSelect: (folderId: string, path: string[]) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onCreateChildFolder: (parentFolderId: string, name: string) => void;
  onDropNote: (noteId: string, folderId: string) => void;
  onHome: () => void;
  onUnfiledSelect: () => void;
  isUnfiledActive: boolean;
  onDropToUnfiled: (noteId: string) => void;
  onPreview: (folderId: string, name: string) => void;
}) {
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isUnfiledDragOver, setIsUnfiledDragOver] = useState(false);

  function submitNewFolder() {
    const name = newFolderName.trim();
    if (name) onCreateFolder(name);
    setNewFolderName("");
    setAddingFolder(false);
  }

  return (
    <nav
      className={`sidebar${open ? " sidebar--open" : ""}`}
      data-testid="sidebar"
      aria-label="Notes"
    >
      <button className="sidebar-home-button" onClick={onHome}>
        Home
      </button>
      <button className="sidebar-new-button" onClick={onCreate}>
        + New Note
      </button>
      <div className="sidebar-folders">
        <div className="sidebar-folders-header">
          <span className="sidebar-folders-label">Folders</span>
          <button
            className="folder-new-btn"
            onClick={() => setAddingFolder(true)}
            title="New folder"
          >
            +
          </button>
        </div>
        <button
          className={`sidebar-unfiled${isUnfiledActive ? " sidebar-unfiled--active" : ""}${isUnfiledDragOver ? " sidebar-unfiled--drag-over" : ""}`}
          onClick={onUnfiledSelect}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
          onDragEnter={() => setIsUnfiledDragOver(true)}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsUnfiledDragOver(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setIsUnfiledDragOver(false);
            const noteId = e.dataTransfer.getData("text/plain");
            if (noteId) onDropToUnfiled(noteId);
          }}
        >
          Unfiled Notes
        </button>
        <FolderTree
          nodes={folders}
          activeFolderId={activeFolderId}
          onSelect={onFolderSelect}
          onRename={onRenameFolder}
          onDelete={onDeleteFolder}
          onCreateChild={onCreateChildFolder}
          onDropNote={onDropNote}
          onPreview={onPreview}
        />
        {addingFolder && (
          <input
            className="folder-new-input"
            autoFocus
            value={newFolderName}
            placeholder="Folder name…"
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNewFolder();
              if (e.key === "Escape") { setNewFolderName(""); setAddingFolder(false); }
            }}
            onBlur={submitNewFolder}
          />
        )}
      </div>
    </nav>
  );
}
