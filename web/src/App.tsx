import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useMatch,
  useNavigate,
  useParams,
} from "react-router";
import { setNoteDate } from "./api/notes";
import { keys } from "./api/queryKeys";
import { useAuth } from "./auth/context";
import styles from "./components/App.module.css";
import FolderPreviewPanel from "./components/FolderPreviewPanel";
import ListView from "./components/ListView";
import NoteView from "./components/NoteView";
import SessionExpiredBanner from "./components/SessionExpiredBanner";
import Sidebar from "./components/Sidebar";
import SignInPage from "./components/SignInPage";
import { useToast } from "./components/toastContext";
import { UNFILED_ID } from "./constants";
import { findNode, findPath } from "./folderTree";
import {
  useCreateFolder,
  useRenameFolder,
  useDeleteFolder,
  useMoveFolder,
} from "./hooks/useFolderMutations";
import { useFolders } from "./hooks/useFolders";
import { useNoteCards } from "./hooks/useNoteCards";
import {
  useCreateNote,
  useRenameNote,
  useDeleteNote,
  useMoveNoteToFolder,
} from "./hooks/useNoteMutations";
import { recordRumEvent } from "./rum";

type NoteNavState = { isNew?: boolean; initialTitle?: string };

export default function App() {
  return (
    <BrowserRouter>
      <AppGate />
    </BrowserRouter>
  );
}

function AppGate() {
  const { idToken, forbidden, sessionExpired, authLoading, signIn, signOut } = useAuth();
  const navigate = useNavigate();
  // OAuth redirects back to the origin root; once authed, restore the deep-link
  // the user originally requested (stashed by signIn in sessionStorage) — 21-C.
  useEffect(() => {
    if (!idToken) return;
    const dest = sessionStorage.getItem("postLoginRedirect");
    if (!dest) return;
    sessionStorage.removeItem("postLoginRedirect");
    if (dest !== window.location.pathname + window.location.search) {
      navigate(dest, { replace: true });
    }
  }, [idToken, navigate]);

  if (sessionExpired) return <SessionExpiredBanner onSignIn={signIn} />;
  // A cold-start silent refresh is in flight — the refresh cookie may still restore the
  // session, so hold a loading state instead of flashing the sign-in screen (BUG-15).
  if (authLoading) return <AuthLoading />;
  if (!idToken) return <SignInPage />;
  if (forbidden) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '1rem', fontFamily: 'sans-serif' }}>
      <p style={{ fontSize: '1.1rem' }}>Your Google account doesn't have access to this app.</p>
      <button onClick={signOut} style={{ padding: '0.5rem 1.25rem', cursor: 'pointer' }}>Sign out</button>
    </div>
  );

  return <AppContent signOut={signOut} />;
}

function AuthLoading() {
  return (
    <div
      data-testid="auth-loading"
      role="status"
      aria-live="polite"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif' }}
    >
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        Restoring your session…
      </span>
      <span aria-hidden="true" className={styles.authSpinner} />
    </div>
  );
}

function AppContent({ signOut }: { signOut: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const qc = useQueryClient();
  const { data: cards = [], isLoading: loading } = useNoteCards();
  const createNote = useCreateNote();
  const renameNote = useRenameNote();
  const deleteNote = useDeleteNote();
  const moveNote = useMoveNoteToFolder();
  const creating = createNote.isPending;
  const createError = createNote.error ? "Failed to create note" : null;
  const { data: folders = [] } = useFolders();
  const createFolderM = useCreateFolder();
  const renameFolderM = useRenameFolder();
  const deleteFolderM = useDeleteFolder();
  const moveFolderM = useMoveFolder();
  // Folder context is derived from the URL (/folders/:folderId; the literal
  // "unfiled" segment maps to UNFILED_ID), not component state — 21-B. The
  // breadcrumb is rebuilt from the folders cache, so a sub-folder shows its full
  // ancestor path and a rename re-derives automatically (the cache is the source).
  const folderMatch = useMatch("/folders/:folderId");
  const folderSeg = folderMatch?.params.folderId;
  const activeFolderId = folderSeg === "unfiled" ? UNFILED_ID : folderSeg;
  const activeFolderPath = useMemo<string[]>(() => {
    if (!activeFolderId) return [];
    if (activeFolderId === UNFILED_ID) return ["Unfiled Notes"];
    return findPath(folders, activeFolderId) ?? [];
  }, [activeFolderId, folders]);
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
    const newFolderId = activeFolderId && activeFolderId !== UNFILED_ID ? activeFolderId : null;
    try {
      // Create inserts the real card (with folderId) on success; then persist the
      // default date and the folder assignment. Navigation keys off the server id.
      const { noteId } = await createNote.mutateAsync({ folderId: newFolderId });
      // Await the date so it is persisted before navigation — otherwise the
      // note-cards refetch on return can land before the date is set, leaving the
      // card date-less and hidden by the home date filter.
      try {
        await setNoteDate(noteId, new Date().toISOString().slice(0, 10));
      } catch {
        // non-fatal: user can set the date manually
      }
      if (newFolderId) moveNote.mutate({ noteId, folderId: newFolderId });
      openNote(noteId, undefined, true);
    } catch {
      // error surfaced via createError (createNote.error)
    }
  }

  async function handleDelete(noteId: string) {
    try {
      await deleteNote.mutateAsync(noteId);
      // Destructive: replace so the deleted note is not reachable via Back.
      navigate("/", { replace: true });
    } catch {
      // rolled back in the mutation's onError; stay on the note
    }
  }

  // NoteCard is presentational; this triggers the delete mutation (optimistic
  // removal from the noteCards cache + DELETE).
  function handleDeleteNote(noteId: string) {
    deleteNote.mutate(noteId);
  }

  function handleRename(noteId: string, title: string) {
    renameNote.mutate({ noteId, title });
  }

  function handleBackFromNote() {
    // On a cold deep-link there is no in-app history entry behind the note, so
    // navigate(-1) would be a no-op; fall back to home. (location.key is
    // "default" only for the initial entry.)
    if (location.key === "default") navigate("/");
    else navigate(-1);
    // The note's content/preview may have changed in NoteView — refresh the list.
    qc.invalidateQueries({ queryKey: keys.noteCards });
  }

  function handleUnfiledSelect() {
    navigate("/folders/unfiled");
    setSidebarOpen(false);
  }

  function handleFolderSelect(folderId: string, folderPath: string[]) {
    navigate(`/folders/${folderId}`);
    setSidebarOpen(false);
    setPreviewFolderId(folderId);
    setPreviewFolderName(folderPath[folderPath.length - 1] ?? "");
  }

  function handleHome() {
    navigate("/");
  }

  function handleCreateFolder(name: string, parentFolderId?: string) {
    // The cache optimism (insert temp folder) + temp-id→real-id reconciliation
    // live in the mutation hook; the component only supplies a temp id.
    createFolderM.mutate({ name, parentFolderId, tempId: `temp-${crypto.randomUUID()}` });
  }

  function handleRenameFolder(folderId: string, name: string) {
    // The breadcrumb is derived from the folders cache, which the rename hook
    // updates and rolls back optimistically — so the heading follows for free.
    renameFolderM.mutate({ folderId, name });
  }

  function handleMoveNoteToFolder(noteId: string, folderId: string | null) {
    moveNote.mutate({ noteId, folderId });
  }

  function handleDeleteFolder(folderId: string) {
    if (activeFolderId === folderId) navigate("/");
    if (previewFolderId === folderId) setPreviewFolderId(null);
    deleteFolderM.mutate({ folderId });
  }

  function handleMoveFolder(folderId: string, parentFolderId: string | null) {
    // Skip self/descendant drops — they would orphan the subtree, and the backend
    // has no cycle guard so a refetch wouldn't recover.
    if (parentFolderId === folderId) return;
    const node = findNode(folders, folderId);
    if (parentFolderId !== null && node && findNode(node.children ?? [], parentFolderId)) return;
    moveFolderM.mutate({ folderId, parentFolderId });
  }

  // Home (`/`) and a folder (`/folders/:id`) render the same ListView; the
  // route-derived activeFolderId/Path switch it between the two.
  const listView = (
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
  );

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
          <Route path="/" element={listView} />
          <Route path="/folders/:folderId" element={listView} />
          <Route
            path="/notes/:noteId"
            element={
              <NoteRoute
                notes={cards}
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
  const navigate = useNavigate();
  const { showError } = useToast();
  const navState = location.state as NoteNavState | null;
  // A deep-link to a deleted/unknown note recovers to home with a toast, and
  // emits a RUM event so the rate of dead links is observable (21-C).
  const handleNotFound = useCallback(() => {
    recordRumEvent("deadNoteLink", { noteId });
    showError("That note no longer exists.");
    navigate("/", { replace: true });
  }, [noteId, navigate, showError]);
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
      onNotFound={handleNotFound}
      isNew={navState?.isNew}
    />
  );
}
