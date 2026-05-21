import "./App.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./auth/AuthContext";
import SessionExpiredBanner from "./components/SessionExpiredBanner";
import SignInPage from "./components/SignInPage";
import FolderPreviewPanel from "./components/FolderPreviewPanel";
import ListView from "./components/ListView";
import NoteView from "./components/NoteView";
import Sidebar from "./components/Sidebar";
import { UNFILED_ID } from "./constants";
import { useNotes } from "./hooks/useNotes";
import {
  FolderNode,
  NoteCard,
  setNoteDate,
  getFolders,
  getNoteCards,
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
  | { kind: "note"; noteId: string; isNew?: boolean; initialTitle?: string };

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
  const { idToken, forbidden, sessionExpired, signIn, signOut } = useAuth();
  if (sessionExpired) return <SessionExpiredBanner onSignIn={signIn} />;
  if (!idToken) return <SignInPage />;
  if (forbidden) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '1rem', fontFamily: 'sans-serif' }}>
      <p style={{ fontSize: '1.1rem' }}>Your Google account doesn't have access to this app.</p>
      <button onClick={signOut} style={{ padding: '0.5rem 1.25rem', cursor: 'pointer' }}>Sign out</button>
    </div>
  );

  return <AppContent signOut={signOut} />;
}

function AppContent({ signOut }: { signOut: () => void }) {
  const [view, setView] = useState<View>({ kind: "list" });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { notes, loading, creating, createError, create, rename, remove } = useNotes();
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | undefined>();
  const [activeFolderPath, setActiveFolderPath] = useState<string[]>([]);
  const [cards, setCards] = useState<NoteCard[]>([]);
  const cardsRef = useRef<NoteCard[]>([]);
  useEffect(() => { cardsRef.current = cards; }, [cards]);

  useEffect(() => {
    getFolders().then(setFolders).catch(() => {});
    getNoteCards().then(setCards).catch(() => {});
  }, []);

  const handleDateSet = useCallback((_noteId: string, _date: string) => {}, []);
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
      const newFolderId = activeFolderId && activeFolderId !== UNFILED_ID ? activeFolderId : null;
      setCards((prev) => [{
        noteId, title: '', contentPreview: '', date: todayAsISO,
        openActions: [], createdAt: new Date().toISOString(), tags: [], folderId: newFolderId,
      }, ...prev]);
      if (newFolderId) {
        apiMoveNoteToFolder(noteId, newFolderId).catch(() => {
          setCards((prev) => prev.map((c) => c.noteId === noteId ? { ...c, folderId: null } : c));
        });
      }
      setView({ kind: "note", noteId, isNew: true });
    } catch {
      // error surfaced by hook via createError
    }
  }

  async function handleDelete(noteId: string) {
    await remove(noteId);
    setCards((prev) => prev.filter((c) => c.noteId !== noteId));
    setView(backDestination());
  }

  // NoteCard calls deleteNote() internally; this callback removes the card from shared state.
  function handleDeleteNote(noteId: string) {
    setCards((prev) => prev.filter((c) => c.noteId !== noteId));
  }

  function handleRename(noteId: string, title: string) {
    const prevTitle = cardsRef.current.find((c) => c.noteId === noteId)?.title ?? '';
    setCards((prev) => prev.map((c) => c.noteId === noteId ? { ...c, title } : c));
    rename(noteId, title).catch(() => {
      setCards((prev) => prev.map((c) => c.noteId === noteId ? { ...c, title: prevTitle } : c));
    });
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
    const prevFolderId = cardsRef.current.find((c) => c.noteId === noteId)?.folderId ?? null;
    setCards((prev) => prev.map((c) => c.noteId === noteId ? { ...c, folderId } : c));
    const apiCall = folderId ? apiMoveNoteToFolder(noteId, folderId) : apiUnfileNote(noteId);
    apiCall.catch(() => {
      setCards((prev) => prev.map((c) => c.noteId === noteId ? { ...c, folderId: prevFolderId } : c));
    });
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
        initialTitle={view.initialTitle ?? notes.find((n) => n.noteId === view.noteId)?.title ?? ""}
        onRename={handleRename}
        onBack={() => { setView(backDestination()); getNoteCards().then(setCards).catch(() => {}); }}
        onDelete={handleDelete}
        onDateSet={handleDateSet}
        isNew={view.isNew}
      />
    ) : (
      <ListView
        cards={cards}
        loading={loading}
        creating={creating}
        createError={createError}
        onNewNote={handleNewNote}
        onEditNote={(noteId) => setView({ kind: "note", noteId })}
        onOpenNote={(noteId, title, isNew?) => setView({ kind: "note", noteId, isNew, ...(title ? { initialTitle: title } : {}) })}
        onDeleteNote={handleDeleteNote}
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
        onSignOut={signOut}
      />
      <FolderPreviewPanel
        folderId={previewFolderId}
        folderName={previewFolderName}
        cards={cards}
        onClose={() => setPreviewFolderId(null)}
        onEditNote={(noteId) => { setView({ kind: "note", noteId }); setPreviewFolderId(null); }}
        onDropNote={(noteId) => handleMoveNoteToFolder(noteId, previewFolderId === UNFILED_ID ? null : previewFolderId)}
      />
      <div className="app-main">{main}</div>
    </div>
  );
}
