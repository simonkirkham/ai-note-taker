import "./App.css";
import { useEffect, useState } from "react";
import FolderPreviewPanel from "./components/FolderPreviewPanel";
import ListView from "./components/ListView";
import NoteView from "./components/NoteView";
import Sidebar from "./components/Sidebar";
import { useNotes } from "./hooks/useNotes";
import {
  FolderNode,
  setNoteDate,
  createFolder as apiCreateFolder,
  renameFolder as apiRenameFolder,
  deleteFolder as apiDeleteFolder,
  moveNoteToFolder as apiMoveNoteToFolder,
  unfileNote as apiUnfileNote,
} from "./api";

type View =
  | { kind: "list" }
  | { kind: "folder"; folderId: string; folderPath: string[] }
  | { kind: "note"; noteId: string };

function addFolderToTree(nodes: FolderNode[], folder: FolderNode, parentId?: string): FolderNode[] {
  if (!parentId) return [...nodes, folder];
  return nodes.map((n) =>
    n.folderId === parentId
      ? { ...n, children: [...n.children, folder] }
      : { ...n, children: addFolderToTree(n.children, folder, parentId) }
  );
}

function renameFolderInTree(nodes: FolderNode[], folderId: string, name: string): FolderNode[] {
  return nodes.map((n) =>
    n.folderId === folderId
      ? { ...n, name }
      : { ...n, children: renameFolderInTree(n.children, folderId, name) }
  );
}

function deleteFolderFromTree(nodes: FolderNode[], folderId: string): FolderNode[] {
  return nodes
    .filter((n) => n.folderId !== folderId)
    .map((n) => ({ ...n, children: deleteFolderFromTree(n.children, folderId) }));
}

const UNFILED_ID = "__unfiled__";

export default function App() {
  const [view, setView] = useState<View>({ kind: "list" });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { notes, loading, creating, createError, create, rename, remove } = useNotes();
  const [folders, setFolders] = useState<FolderNode[]>(() => {
    try { return JSON.parse(localStorage.getItem("notetaker-folders") ?? "[]"); } catch { return []; }
  });
  const [activeFolderId, setActiveFolderId] = useState<string | undefined>();
  const [activeFolderPath, setActiveFolderPath] = useState<string[]>([]);
  const [noteFolderMap, setNoteFolderMap] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("notetaker-note-folder-map") ?? "{}"); } catch { return {}; }
  });
  const [noteDateMap, setNoteDateMap] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("notetaker-note-date-map") ?? "{}"); } catch { return {}; }
  });

  useEffect(() => {
    localStorage.setItem("notetaker-folders", JSON.stringify(folders));
  }, [folders]);

  useEffect(() => {
    localStorage.setItem("notetaker-note-folder-map", JSON.stringify(noteFolderMap));
  }, [noteFolderMap]);

  useEffect(() => {
    localStorage.setItem("notetaker-note-date-map", JSON.stringify(noteDateMap));
  }, [noteDateMap]);

  function handleDateSet(noteId: string, date: string) {
    setNoteDateMap((prev) => ({ ...prev, [noteId]: date }));
  }
  const [previewFolderId, setPreviewFolderId] = useState<string | null>(null);
  const [previewFolderName, setPreviewFolderName] = useState("");

  async function handleNewNote() {
    try {
      const noteId = await create();
      const todayAsISO = new Date().toISOString().slice(0, 10);
      try {
        await setNoteDate(noteId, todayAsISO);
      } catch {
        // non-fatal: date will default to empty; user can set it manually
      }
      if (activeFolderId && activeFolderId !== UNFILED_ID) {
        handleMoveNoteToFolder(noteId, activeFolderId);
      }
      setView({ kind: "note", noteId });
    } catch {
      // error surfaced by hook via createError
    }
  }

  async function handleDelete(noteId: string) {
    await remove(noteId);
    setView(backDestination());
  }

  function backDestination(): View {
    if (activeFolderId) return { kind: "folder", folderId: activeFolderId, folderPath: activeFolderPath };
    return { kind: "list" };
  }

  function handleUnfiledSelect() {
    setActiveFolderId(UNFILED_ID);
    setActiveFolderPath(["Unfiled Notes"]);
    setView({ kind: "folder", folderId: UNFILED_ID, folderPath: ["Unfiled Notes"] });
    setSidebarOpen(false);
  }

  function handleFolderSelect(folderId: string, folderPath: string[]) {
    setActiveFolderId(folderId);
    setActiveFolderPath(folderPath);
    setView({ kind: "folder", folderId, folderPath });
    setSidebarOpen(false);
    setPreviewFolderId(folderId);
    setPreviewFolderName(folderPath[folderPath.length - 1] ?? "");
  }

  function handleHome() {
    setActiveFolderId(undefined);
    setActiveFolderPath([]);
    setView({ kind: "list" });
  }

  function handleCreateFolder(name: string, parentFolderId?: string) {
    const newFolder: FolderNode = { folderId: crypto.randomUUID(), name, children: [] };
    setFolders((prev) => addFolderToTree(prev, newFolder, parentFolderId));
    apiCreateFolder(name, parentFolderId).catch(() => {});
  }

  function handleRenameFolder(folderId: string, name: string) {
    setFolders((prev) => renameFolderInTree(prev, folderId, name));
    apiRenameFolder(folderId, name).catch(() => {});
  }

  function handleMoveNoteToFolder(noteId: string, folderId: string | null) {
    setNoteFolderMap((prev) => {
      const next = { ...prev };
      if (folderId) next[noteId] = folderId;
      else delete next[noteId];
      return next;
    });
    if (folderId) apiMoveNoteToFolder(noteId, folderId).catch(() => {});
    else apiUnfileNote(noteId).catch(() => {});
  }

  function handleDeleteFolder(folderId: string) {
    setFolders((prev) => deleteFolderFromTree(prev, folderId));
    if (activeFolderId === folderId) {
      setActiveFolderId(undefined);
      setActiveFolderPath([]);
      setView({ kind: "list" });
    }
    apiDeleteFolder(folderId).catch(() => {});
  }

  const activeNoteId = view.kind === "note" ? view.noteId : undefined;

  const main =
    view.kind === "note" ? (
      <NoteView
        key={view.noteId}
        noteId={view.noteId}
        initialTitle={notes.find((n) => n.noteId === view.noteId)?.title ?? ""}
        onRename={rename}
        onBack={() => setView(backDestination())}
        onDelete={handleDelete}
        onDateSet={handleDateSet}
      />
    ) : (
      <ListView
        loading={loading}
        creating={creating}
        createError={createError}
        onNewNote={handleNewNote}
        onEditNote={(noteId) => setView({ kind: "note", noteId })}
        folderPath={view.kind === "folder" ? view.folderPath : undefined}
        currentFolderId={view.kind === "folder" ? view.folderId : undefined}
        noteFolderMap={noteFolderMap}
        onHome={handleHome}
      />
    );

  return (
    <div className="app-layout">
      <button
        className="sidebar-toggle"
        aria-label="Toggle sidebar"
        onClick={() => setSidebarOpen((o) => !o)}
      >
        ☰
      </button>
      <div
        className={`sidebar-overlay${sidebarOpen ? " sidebar-overlay--open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />
      <Sidebar
        notes={notes}
        activeNoteId={activeNoteId}
        open={sidebarOpen}
        onSelect={(noteId) => { setView({ kind: "note", noteId }); setSidebarOpen(false); }}
        onCreate={handleNewNote}
        folders={folders}
        activeFolderId={activeFolderId}
        onFolderSelect={handleFolderSelect}
        onCreateFolder={(name) => handleCreateFolder(name)}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
        onCreateChildFolder={(parentId, name) => handleCreateFolder(name, parentId)}
        onDropNote={handleMoveNoteToFolder}
        onHome={handleHome}
        onUnfiledSelect={handleUnfiledSelect}
        isUnfiledActive={activeFolderId === UNFILED_ID}
        onDropToUnfiled={(noteId) => handleMoveNoteToFolder(noteId, null)}
        onPreview={(folderId, name) => { setPreviewFolderId(folderId); setPreviewFolderName(name); }}
      />
      <FolderPreviewPanel
        folderId={previewFolderId}
        folderName={previewFolderName}
        notes={notes}
        noteFolderMap={noteFolderMap}
        noteDateMap={noteDateMap}
        onClose={() => setPreviewFolderId(null)}
        onEditNote={(noteId) => { setView({ kind: "note", noteId }); setPreviewFolderId(null); }}
      />
      <div className="app-main">{main}</div>
    </div>
  );
}
