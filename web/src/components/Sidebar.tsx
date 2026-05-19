import { useState } from "react";
import { FolderNode } from "../api";
import { UNFILED_ID } from "../constants";
import FolderTree from "./FolderTree";

export default function Sidebar({
  open,
  onCreate,
  folders,
  activeFolderId,
  onFolderSelect,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onCreateChildFolder,
  onDropNote,
  onMoveFolder,
  onHome,
  onUnfiledSelect,
  isUnfiledActive,
  onDropToUnfiled,
  onPreview,
  onSignOut,
}: {
  open?: boolean;
  onCreate: () => void;
  folders: FolderNode[];
  activeFolderId?: string;
  onFolderSelect: (folderId: string, path: string[]) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onCreateChildFolder: (parentFolderId: string, name: string) => void;
  onDropNote: (noteId: string, folderId: string) => void;
  onMoveFolder?: (folderId: string, parentFolderId: string | null) => void;
  onHome: () => void;
  onUnfiledSelect: () => void;
  isUnfiledActive: boolean;
  onDropToUnfiled: (noteId: string) => void;
  onPreview: (folderId: string, name: string) => void;
  onSignOut?: () => void;
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
      <button
        className="sidebar-home-button"
        data-testid="home-button"
        onClick={onHome}
        aria-label="Home"
      >
        Home
      </button>
      <button
        className="sidebar-new-button"
        data-testid="new-note-button"
        onClick={onCreate}
        aria-label="New Note"
      >
        + New Note
      </button>
      <div className="sidebar-folders">
        <div className="sidebar-folders-header">
          <span className="sidebar-folders-label">Folders</span>
          <button
            className="folder-new-btn"
            data-testid="new-folder-button"
            onClick={() => setAddingFolder(true)}
            title="New folder"
            aria-label="New folder"
          >
            +
          </button>
        </div>
        <div className="sidebar-unfiled-row">
          <button
            className={`sidebar-unfiled${isUnfiledActive ? " sidebar-unfiled--active" : ""}${isUnfiledDragOver ? " sidebar-unfiled--drag-over" : ""}`}
            data-testid="unfiled-notes-button"
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
            aria-label="Unfiled Notes"
          >
            Unfiled Notes
          </button>
          <button
            className="folder-tree-action-btn"
            data-testid="unfiled-preview-button"
            onClick={(e) => { e.stopPropagation(); onPreview(UNFILED_ID, "Unfiled Notes"); }}
            title="Preview unfiled notes"
            aria-label="Preview unfiled notes"
          >
            »
          </button>
        </div>
        <FolderTree
          nodes={folders}
          activeFolderId={activeFolderId}
          onSelect={onFolderSelect}
          onRename={onRenameFolder}
          onDelete={onDeleteFolder}
          onCreateChild={onCreateChildFolder}
          onDropNote={onDropNote}
          onMoveFolder={onMoveFolder}
          onPreview={onPreview}
        />
        {addingFolder && (
          <input
            className="folder-new-input"
            data-testid="new-folder-input"
            autoFocus
            value={newFolderName}
            placeholder="Folder name…"
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNewFolder();
              if (e.key === "Escape") { setNewFolderName(""); setAddingFolder(false); }
            }}
            onBlur={submitNewFolder}
            aria-label="New folder name"
          />
        )}
      </div>
      {onSignOut && (
        <button className="sidebar-sign-out" onClick={onSignOut}>Sign out</button>
      )}
    </nav>
  );
}
