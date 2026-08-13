import clsx from "clsx";
import { useState } from "react";
import { FolderNode } from "../api/folders";
import { UNFILED_ID } from "../constants";
import { buildLabel, buildTitle } from "../lib/buildInfo";
import FolderTree from "./FolderTree";
import folderTreeStyles from "./FolderTree.module.css";
import KeepAudioLocalToggle from "./KeepAudioLocalToggle";
import styles from "./Sidebar.module.css";
import ThemePicker from "./ThemePicker";
import TranscriptionModeToggle from "./TranscriptionModeToggle";
import WorkspaceSwitcher from "./WorkspaceSwitcher";

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
  previewFolderId,
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
  previewFolderId: string | null;
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
      className={clsx(styles.sidebar, open && styles.sidebarOpen)}
      data-testid="sidebar"
      aria-label="Notes"
    >
      <WorkspaceSwitcher />
      <button
        className={styles.sidebarHomeButton}
        data-testid="home-button"
        onClick={onHome}
        aria-label="Home"
      >
        Home
      </button>
      <button
        className={styles.sidebarNewButton}
        data-testid="new-note-button"
        onClick={onCreate}
        aria-label="New Note"
      >
        + New Note
      </button>
      <div className={styles.sidebarFolders}>
        <div className={styles.sidebarFoldersHeader}>
          <span className={styles.sidebarFoldersLabel}>Folders</span>
          <button
            className={styles.folderNewBtn}
            data-testid="new-folder-button"
            onClick={() => setAddingFolder(true)}
            title="New folder"
            aria-label="New folder"
          >
            +
          </button>
        </div>
        <div className={styles.sidebarUnfiledRow}>
          <button
            className={clsx(
              styles.sidebarUnfiled,
              isUnfiledActive && styles.sidebarUnfiledActive,
              isUnfiledDragOver && styles.sidebarUnfiledDragOver,
            )}
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
            className={folderTreeStyles.folderTreeActionBtn}
            data-testid="unfiled-preview-button"
            onClick={(e) => { e.stopPropagation(); onPreview(UNFILED_ID, "Unfiled Notes"); }}
            title={previewFolderId === UNFILED_ID ? "Close unfiled preview" : "Preview unfiled notes"}
            aria-label={previewFolderId === UNFILED_ID ? "Close unfiled preview" : "Preview unfiled notes"}
          >
            {previewFolderId === UNFILED_ID ? "«" : "»"}
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
          previewFolderId={previewFolderId}
          onPreview={onPreview}
        />
        {addingFolder && (
          // autoFocus is intentional: the new-folder input appears when the user
          // chooses to add a folder, so focusing it is the expected behaviour.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          <input autoFocus
            className={styles.folderNewInput}
            data-testid="new-folder-input"
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
      <div className={styles.sidebarFooter}>
        <TranscriptionModeToggle />
        <KeepAudioLocalToggle />
        <ThemePicker />
        {onSignOut && (
          <button
            className={styles.sidebarSignOut}
            data-testid="sign-out-button"
            aria-label="Sign out"
            onClick={onSignOut}
          >Sign out</button>
        )}
        <div
          className={styles.sidebarBuild}
          data-testid="build-number"
          title={buildTitle()}
        >{buildLabel()}</div>
      </div>
    </nav>
  );
}
