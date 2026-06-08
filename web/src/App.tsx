import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import {
  FolderNode,
  getFolders,
  createFolder as apiCreateFolder,
  renameFolder as apiRenameFolder,
  deleteFolder as apiDeleteFolder,
  moveNoteToFolder as apiMoveNoteToFolder,
  unfileNote as apiUnfileNote,
  moveFolder as apiMoveFolder,
} from "./api/folders";
import { NoteCard, setNoteDate, getNoteCards } from "./api/notes";
import { useAuth } from "./auth/context";
import styles from "./components/App.module.css";
import FolderPreviewPanel from "./components/FolderPreviewPanel";
import ListView from "./components/ListView";
import NoteView from "./components/NoteView";
import SessionExpiredBanner from "./components/SessionExpiredBanner";
import Sidebar from "./components/Sidebar";
import SignInPage from "./components/SignInPage";
import { UNFILED_ID } from "./constants";
import { useNotes } from "./hooks/useNotes";

type NoteNavState = { isNew?: boolean; initialTitle?: string };

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
  return (
    <BrowserRouter>
      <AppGate />
    </BrowserRouter>
  );
}

function AppGate() {
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
  const navigate = useNavigate();
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

  function openNote(noteId: string, title?: string, isNew?: boolean) {
    const state: NoteNavState = {};
    if (isNew) state.isNew = true;
    if (title) state.initialTitle = title;
    navigate(`/notes/${noteId}`, { state });
  }

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
        openActions: [], createdAt: new Date().toISOString(),
        lastModifiedAt: new Date().toISOString(), tags: [], folderId: newFolderId,
      }, ...prev]);
      if (newFolderId) {
        apiMoveNoteToFolder(noteId, newFolderId).catch(() => {
          setCards((prev) => prev.map((c) => c.noteId === noteId ? { ...c, folderId: null } : c));
        });
      }
      openNote(noteId, undefined, true);
    } catch {
      // error surfaced by hook via createError
    }
  }

  async function handleDelete(noteId: string) {
    await remove(noteId);
    setCards((prev) => prev.filter((c) => c.noteId !== noteId));
    navigate("/");
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

  function handleBackFromNote() {
    navigate(-1);
    getNoteCards().then(setCards).catch(() => {});
  }

  function handleUnfiledSelect() {
    setActiveFolderId(UNFILED_ID);
    setActiveFolderPath(["Unfiled Notes"]);
    navigate("/");
    setSidebarOpen(false);
  }

  function handleFolderSelect(folderId: string, folderPath: string[]) {
    setActiveFolderId(folderId);
    setActiveFolderPath(folderPath);
    navigate("/");
    setSidebarOpen(false);
    setPreviewFolderId(folderId);
    setPreviewFolderName(folderPath[folderPath.length - 1] ?? "");
  }

  function handleHome() {
    setActiveFolderId(undefined);
    setActiveFolderPath([]);
    navigate("/");
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
    setFolders((prev) => mapTree(prev, folderId, (n) => ({ ...n, name })));
    if (folderId === activeFolderId) {
      setActiveFolderPath((prev) =>
        prev.map((seg, i) => (i === prev.length - 1 ? name : seg)),
      );
    }
    apiRenameFolder(folderId, name)
      .then(() => getFolders().then(setFolders))
      .catch(() => {
        setFolders(prevFolders);
        setActiveFolderPath(prevActiveFolderPath);
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
      navigate("/");
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

  return (
    <div className={styles.appLayout}>
      <button
        data-testid="sidebar-toggle"
        className={styles.sidebarToggle}
        aria-label="Toggle sidebar"
        onClick={() => setSidebarOpen((o) => !o)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <div
        className={clsx(styles.sidebarOverlay, sidebarOpen && styles.sidebarOverlayOpen)}
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
        previewFolderId={previewFolderId}
        onPreview={(folderId, name) => {
          // CHANGE-11: clicking the preview button toggles — close it if this
          // folder is already previewed, otherwise open it.
          setPreviewFolderId((prev) => (prev === folderId ? null : folderId));
          setPreviewFolderName(name);
        }}
        onSignOut={signOut}
      />
      <FolderPreviewPanel
        folderId={previewFolderId}
        folderName={previewFolderName}
        cards={cards}
        onClose={() => setPreviewFolderId(null)}
        onEditNote={(noteId) => { openNote(noteId); setPreviewFolderId(null); }}
        onDropNote={(noteId) => handleMoveNoteToFolder(noteId, previewFolderId === UNFILED_ID ? null : previewFolderId)}
      />
      <div className={styles.appMain}>
        <Routes>
          <Route
            path="/"
            element={
              <ListView
                cards={cards}
                loading={loading}
                creating={creating}
                createError={createError}
                onNewNote={handleNewNote}
                onEditNote={(noteId) => openNote(noteId)}
                onOpenNote={(noteId, title, isNew) => openNote(noteId, title, isNew)}
                onDeleteNote={handleDeleteNote}
                folderPath={activeFolderId ? activeFolderPath : undefined}
                currentFolderId={activeFolderId}
                onHome={handleHome}
              />
            }
          />
          <Route
            path="/notes/:noteId"
            element={
              <NoteRoute
                notes={notes}
                onRename={handleRename}
                onBack={handleBackFromNote}
                onDelete={handleDelete}
                onDateSet={handleDateSet}
                onOpenNote={openNote}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

function NoteRoute({
  notes,
  onRename,
  onBack,
  onDelete,
  onDateSet,
  onOpenNote,
}: {
  notes: { noteId: string; title: string }[];
  onRename: (noteId: string, title: string) => void;
  onBack: () => void;
  onDelete: (noteId: string) => Promise<void>;
  onDateSet: (noteId: string, date: string) => void;
  onOpenNote: (noteId: string, title?: string, isNew?: boolean) => void;
}) {
  const { noteId } = useParams();
  const location = useLocation();
  const navState = location.state as NoteNavState | null;
  if (!noteId) return <Navigate to="/" replace />;
  return (
    <NoteView
      key={noteId}
      noteId={noteId}
      initialTitle={navState?.initialTitle ?? notes.find((n) => n.noteId === noteId)?.title ?? ""}
      onRename={onRename}
      onBack={onBack}
      onDelete={onDelete}
      onDateSet={onDateSet}
      onOpenNote={onOpenNote}
      isNew={navState?.isNew}
    />
  );
}
