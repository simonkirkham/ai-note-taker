import "./App.css";
import { useCallback, useEffect, useState } from "react";
import FolderPreviewPanel from "./components/FolderPreviewPanel";
import ListView from "./components/ListView";
import NoteView from "./components/NoteView";
import Sidebar from "./components/Sidebar";
import { UNFILED_ID } from "./constants";
import { useNotes } from "./hooks/useNotes";
import {
  FolderNode,
  setNoteDate,
  getFolders,
  createFolder as apiCreateFolder,
  renameFolder as apiRenameFolder,
  deleteFolder as apiDeleteFolder,
  moveNoteToFolder as apiMoveNoteToFolder,
  unfileNote as apiUnfileNote,
  moveFolder as apiMoveFolder,
} from "./api";

type View =
  | { kind: "list" }
  | { kind: "folder"; folderId: string; folderPath: string[] }
  | { kind: "note"; noteId: string };

function mapTree(
  nodes: FolderNode[],
  folderId: string,
  update: (n: FolderNode) => FolderNode,
): FolderNode[] {
  return nodes.map((n) =>
    n.folderId === folderId
      ? update(n)
      : { ...n, children: mapTree(n.children ?? [], folderId, update) },
  );
}

function removeFromTree(nodes: FolderNode[], folderId: string): FolderNode[] {
  return nodes
    .filter((n) => n.folderId !== folderId)
    .map((n) => ({ ...n, children: removeFromTree(n.children ?? [], folderId) }));
}

export default function App() {
  const [view, setView] = useState<View>({ kind: "list" });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { notes, loading, creating, createError, create, rename, remove } = useNotes();
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | undefined>();
  const [activeFolderPath, setActiveFolderPath] = useState<string[]>([]);

  useEffect(() => {
    getFolders().then(setFolders).catch(() => {});
  }, []);

  const handleDateSet = useCallback((_noteId: string, _date: string) => {
    // date persisted by NoteView via API; cards refreshed on next mount
  }, []);
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

  async function handleCreateFolder(name: string, parentFolderId?: string) {
    const tempId = `temp-${crypto.randomUUID()}`;
    const tempFolder: FolderNode = { folderId: tempId, name, children: [] };
    if (parentFolderId) {
      setFolders((prev) => mapTree(prev, parentFolderId, (n) => ({ ...n, children: [...(n.children ?? []), tempFolder] })));
    } else {
      setFolders((prev) => [...prev, tempFolder]);
    }
    try {
      await apiCreateFolder(name, parentFolderId);
      getFolders().then(setFolders).catch(() => {});
    } catch {
      setFolders((prev) => removeFromTree(prev, tempId));
    }
  }

  function handleRenameFolder(folderId: string, name: string) {
    const prevFolders = folders;
    const prevActiveFolderPath = activeFolderPath;
    const prevView = view;
    setFolders((prev) => mapTree(prev, folderId, (n) => ({ ...n, name })));
    if (folderId === activeFolderId) {
      const updatePath = (prev: string[]) =>
        prev.map((seg, i) => (i === prev.length - 1 ? name : seg));
      setActiveFolderPath(updatePath);
      setView((prev) =>
        prev.kind === "folder" && prev.folderId === folderId
          ? { ...prev, folderPath: updatePath(prev.folderPath) }
          : prev,
      );
    }
    apiRenameFolder(folderId, name)
      .then(() => getFolders().then(setFolders))
      .catch(() => {
        setFolders(prevFolders);
        setActiveFolderPath(prevActiveFolderPath);
        setView(prevView);
      });
  }

  function handleMoveNoteToFolder(noteId: string, folderId: string | null) {
    if (folderId) apiMoveNoteToFolder(noteId, folderId).catch(() => {});
    else apiUnfileNote(noteId).catch(() => {});
  }

  function handleDeleteFolder(folderId: string) {
    if (activeFolderId === folderId) {
      setActiveFolderId(undefined);
      setActiveFolderPath([]);
      setView({ kind: "list" });
    }
    if (previewFolderId === folderId) setPreviewFolderId(null);
    apiDeleteFolder(folderId)
      .then(() => getFolders().then(setFolders))
      .catch(() => {});
  }

  function handleMoveFolder(folderId: string, parentFolderId: string | null) {
    apiMoveFolder(folderId, parentFolderId)
      .then(() => getFolders().then(setFolders))
      .catch(() => {});
  }

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
        onHome={handleHome}
      />
    );

  return (
    <div className="app-layout">
      <button
        data-testid="sidebar-toggle"
        className="sidebar-toggle"
        aria-label="Toggle sidebar"
        onClick={() => setSidebarOpen((o) => !o)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <div
        className={`sidebar-overlay${sidebarOpen ? " sidebar-overlay--open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />
      <Sidebar
        open={sidebarOpen}
        onCreate={handleNewNote}
        folders={folders}
        activeFolderId={activeFolderId}
        onFolderSelect={handleFolderSelect}
        onCreateFolder={(name) => handleCreateFolder(name)}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
        onCreateChildFolder={(parentId, name) => handleCreateFolder(name, parentId)}
        onDropNote={handleMoveNoteToFolder}
        onMoveFolder={handleMoveFolder}
        onHome={handleHome}
        onUnfiledSelect={handleUnfiledSelect}
        isUnfiledActive={activeFolderId === UNFILED_ID}
        onDropToUnfiled={(noteId) => handleMoveNoteToFolder(noteId, null)}
        onPreview={(folderId, name) => { setPreviewFolderId(folderId); setPreviewFolderName(name); }}
      />
      <FolderPreviewPanel
        folderId={previewFolderId}
        folderName={previewFolderName}
        onClose={() => setPreviewFolderId(null)}
        onEditNote={(noteId) => { setView({ kind: "note", noteId }); setPreviewFolderId(null); }}
      />
      <div className="app-main">{main}</div>
    </div>
  );
}
