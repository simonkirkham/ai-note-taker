import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { LeaveGuardContext, useRequestLeave } from "./components/leaveGuardContext";
import ListView from "./components/ListView";
import NoteView from "./components/NoteView";
import OpenNoteTabs from "./components/OpenNoteTabs";
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
  useDeleteNote,
  useMoveNoteToFolder,
  useMoveNoteToWorkspace,
} from "./hooks/useNoteMutations";
import { neighbourOf, useOpenNoteTabs } from "./hooks/useOpenNoteTabs";
import { useWorkspaces } from "./hooks/useWorkspaces";
import { recordRumEvent } from "./rum";
import { useCurrentWorkspace } from "./workspace/context";
import { WorkspaceProvider } from "./workspace/WorkspaceContext";
import { DEFAULT_WORKSPACE_ID } from "./workspace/workspaceStore";

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
    // A browser that refuses storage (private mode, quota) THROWS here rather than
    // returning null — unguarded, that took the whole app down on mount. Losing the
    // deep-link restore is the correct degradation; crashing is not.
    let dest: string | null;
    try {
      dest = sessionStorage.getItem("postLoginRedirect");
      if (dest) sessionStorage.removeItem("postLoginRedirect");
    } catch {
      return;
    }
    if (!dest) return;
    if (dest !== window.location.pathname + window.location.search) {
      void navigate(dest, { replace: true });
    }
  }, [idToken, navigate]);

  if (sessionExpired) return <SessionExpiredBanner onSignIn={() => void signIn()} />;
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

  // Every screen lives under a `/w/:wsId` prefix; bare `/` and any unknown path
  // redirect to the default workspace (23-D). Deep links like `/w/{ws}/notes/{id}`
  // are preserved through the postLoginRedirect restore above.
  return (
    <Routes>
      <Route
        path="/w/:wsId/*"
        element={
          <WorkspaceProvider>
            <AppContent signOut={signOut} />
          </WorkspaceProvider>
        }
      />
      <Route path="*" element={<Navigate to={`/w/${DEFAULT_WORKSPACE_ID}`} replace />} />
    </Routes>
  );
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
  const wsId = useCurrentWorkspace();
  // Build a workspace-scoped path; `w("")` is the workspace home (`/w/{wsId}`).
  const w = (p: string) => `/w/${wsId}${p}`;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const qc = useQueryClient();
  const { data: cards = [], isLoading: loading, dataUpdatedAt: cardsUpdatedAt } = useNoteCards();
  // "Has a cards read ever succeeded?" — NOT `isLoading`, and NOT `isSuccess`.
  //   !isLoading — a FAILED read also stops loading, with no data, so the reconcile below
  //                would read every tab as "the note is gone" and collapse the bar on one blip.
  //   isSuccess  — query-core's error reducer sets status "error" UNCONDITIONALLY, even when
  //                `data` still holds the last good list. One failed BACKGROUND refetch would
  //                flip it false while `cards` is perfectly usable, and a tab whose note was
  //                deleted on another device would reappear until the next success.
  // `dataUpdatedAt` is stamped only by a success and survives a later error, so the last good
  // snapshot keeps governing — which is the intent: reconcile against real data, never against
  // the absence of data.
  const cardsLoaded = cardsUpdatedAt > 0;
  const createNote = useCreateNote();
  const deleteNote = useDeleteNote();
  const moveNote = useMoveNoteToFolder();
  const moveNoteToWorkspaceM = useMoveNoteToWorkspace();
  const { data: workspaces = [] } = useWorkspaces();
  // Move targets = the caller's workspaces minus the one currently being viewed.
  const otherWorkspaces = workspaces
    .filter((ws) => ws.workspaceId !== wsId)
    .map((ws) => ({ workspaceId: ws.workspaceId, name: ws.name }));
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
  const folderMatch = useMatch("/w/:wsId/folders/:folderId");
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

  // 49-A — the open-note tab bar. The ACTIVE tab is derived from the URL, never stored
  // twice; the tab set is the only new state.
  const noteMatch = useMatch("/w/:wsId/notes/:noteId");
  const activeNoteId = noteMatch?.params.noteId;
  const { tabs, openTab, closeTab } = useOpenNoteTabs(wsId);
  // Titles follow the note-cards list so a rename re-derives; the title captured at open
  // time covers a note too new to be in the list yet.
  //
  // The note in the URL is always shown as a tab, even when nothing opened it through this
  // app session — a cold deep-link, or Back onto a note whose tab was closed. Without this
  // the bar would render the wrong thing (tabs with no active one) or nothing at all while
  // a note is plainly open. Adopting it here rather than in an effect keeps the tab set out
  // of render-time setState.
  // 49-B: a restored tab whose note has since been deleted — or moved to another workspace —
  // is dropped rather than shown as a dead tab. Derived, not stored: reconciling by writing
  // state would need an effect, and an effect that runs before `cards` arrives would wipe
  // every tab on every cold start. Filtering only once the list has loaded makes that
  // impossible by construction. The note being VIEWED is never dropped — it is open by
  // definition, even if the list hasn't caught up with it yet.
  const openNoteTabs = useMemo(() => {
    const titles = new Map(cards.map((c) => [c.noteId, c.title]));
    // Only a read that actually succeeded is evidence a note no longer exists — see
    // `cardsLoaded` above for why neither `isLoading` nor `isSuccess` says that.
    const live = cardsLoaded
      ? tabs.filter((t) => t.noteId === activeNoteId || titles.has(t.noteId))
      : tabs;
    const adopted =
      !activeNoteId || live.some((t) => t.noteId === activeNoteId)
        ? live
        : [...live, { noteId: activeNoteId, title: "" }];
    return adopted.map((tab) => ({
      noteId: tab.noteId,
      title: titles.get(tab.noteId) || tab.title || "Untitled note",
    }));
  }, [tabs, cards, activeNoteId, cardsLoaded]);

  // 49-B observability: the reconcile above is silent by design — a dropped tab looks exactly
  // like a tab the user never had. A MASS drop, though, means the cards read came back empty
  // or partial for a reason that is not "the user deleted these" (a workspace-scoping bug, a
  // projection that lost the notes), and the only symptom is an empty bar the user cannot
  // explain. Reported from an effect rather than the memo, which must stay pure; the signature
  // guard keeps a refetch from re-reporting the same drop every poll.
  const reportedDropRef = useRef("");
  useEffect(() => {
    if (!cardsLoaded) return;
    const known = new Set(cards.map((c) => c.noteId));
    const dropped = tabs.filter((t) => t.noteId !== activeNoteId && !known.has(t.noteId));
    if (dropped.length === 0) {
      reportedDropRef.current = "";
      return;
    }
    const signature = dropped
      .map((t) => t.noteId)
      .sort()
      .join(",");
    if (signature === reportedDropRef.current) return;
    reportedDropRef.current = signature;
    recordRumEvent("tabsDropped", {
      dropped: dropped.length,
      remaining: tabs.length - dropped.length,
    });
  }, [cardsLoaded, tabs, cards, activeNoteId]);

  // Set by the mounted NoteView while it is recording; see requestLeave below.
  const leaveGuardRef = useRef<((proceed: () => void, destination: string) => void) | null>(null);
  const registerLeaveGuard = useCallback(
    (guard: ((proceed: () => void, destination: string) => void) | null) => {
      leaveGuardRef.current = guard;
    },
    [],
  );

  // `onProceed` is for a caller's own side effect that must not fire if the user declines a
  // mid-recording leave (e.g. closing the folder preview panel).
  function openNote(noteId: string, title?: string, isNew?: boolean, onProceed?: () => void) {
    // Already on this note: the route is unchanged, so nothing unmounts and there is no
    // recording to protect — asking would stop a capture for a no-op navigation. The
    // caller's side effect still applies (the preview panel should close either way).
    if (noteId === activeNoteId) {
      onProceed?.();
      return;
    }
    const state: NoteNavState = {};
    if (isNew) state.isNew = true;
    if (title) state.initialTitle = title;
    // 49-A: opening a note adds it to the open set (a no-op if it is already there, so
    // re-opening focuses the existing tab rather than duplicating it) and navigates. Guarded
    // like a tab switch: `onOpenNote` is reachable from INSIDE a recording note (the `/ai`
    // create-note and next-occurrence paths), and it unmounts that note just the same.
    requestLeave(() => {
      // The count rides the event so an unbounded bar — which would mean the dedupe above
      // has regressed — is visible without a user reporting it. Count the RECONCILED set,
      // not the raw one: since 49-B the stored set retains dead ids until the next write, so
      // `tabs.length` over-reports by exactly the tabs the user cannot see — inflating the
      // one signal that exists to detect an unbounded bar.
      if (!tabs.some((t) => t.noteId === noteId)) {
        recordRumEvent("noteTabOpened", { tabCount: openNoteTabs.length + 1 });
      }
      openTab(noteId, title);
      void navigate(w(`/notes/${noteId}`), { state });
      onProceed?.();
    }, openNoteDestination(noteId, title, isNew));
  }

  // CHANGE-33. Most openNote callers pass no title (the preview panel, "+ New Note"), so
  // fall back to the card list before giving up on a generic phrase — a named note is the
  // whole point of the banner.
  function openNoteDestination(noteId: string, title?: string, isNew?: boolean) {
    if (isNew) return "open the new note";
    const known = title || cards.find((c) => c.noteId === noteId)?.title;
    return known ? `open ${known}` : "open that note";
  }

  // 49-A: switching or closing a tab is an in-app navigate, which does NOT fire the popstate
  // trap that protects a recording (BUG-34) — so the mounted note gets to intercept the leave
  // first. The guard takes ownership of `proceed` and runs it once the user confirms.
  // Stable identity: it reads a ref, so it never needs to change — and it is a context
  // value, so a new one each render would re-render every consumer.
  const requestLeave = useCallback((proceed: () => void, destination: string) => {
    const guard = leaveGuardRef.current;
    if (guard) guard(proceed, destination);
    else proceed();
  }, []);

  function handleSelectTab(noteId: string) {
    if (noteId === activeNoteId) return;
    // CHANGE-33: openNoteTabs already resolves a blank title to "Untitled note".
    const title = openNoteTabs.find((t) => t.noteId === noteId)?.title;
    requestLeave(() => void navigate(w(`/notes/${noteId}`)), `open ${title ?? "that note"}`);
  }

  function handleCloseTab(noteId: string) {
    // Neighbour comes from the RENDERED tabs, which include an adopted active note.
    const next = neighbourOf(openNoteTabs, noteId);
    const doClose = () => {
      closeTab(noteId);
      if (noteId !== activeNoteId) return;
      void navigate(next ? w(`/notes/${next}`) : w(""));
    };
    // Closing the note being recorded into unmounts it — same protection as switching away.
    // Named "close this tab", not by the note it lands on: closing is what the user asked
    // for, and where it lands (the neighbour, or home) is a consequence they did not pick.
    if (noteId === activeNoteId) requestLeave(doClose, "close this tab");
    else doClose();
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
      // 49-A: a note that no longer exists must not be left behind as a tab — clicking it
      // would only reach the dead-link recovery.
      closeTab(noteId);
      // Destructive: replace so the deleted note is not reachable via Back.
      void navigate(w(""), { replace: true });
    } catch {
      // rolled back in the mutation's onError; stay on the note
    }
  }

  // A note moved out of this workspace no longer belongs in this workspace's tab bar.
  function handleMoveNoteToWorkspace(noteId: string, workspaceId: string) {
    closeTab(noteId);
    moveNoteToWorkspaceM.mutate({ noteId, workspaceId });
  }

  // NoteCard is presentational; this triggers the delete mutation (optimistic
  // removal from the noteCards cache + DELETE).
  function handleDeleteNote(noteId: string) {
    closeTab(noteId);
    deleteNote.mutate(noteId);
  }

  function handleBackFromNote() {
    // On a cold deep-link there is no in-app history entry behind the note, so
    // navigate(-1) would be a no-op; fall back to home. (location.key is
    // "default" only for the initial entry.)
    if (location.key === "default") void navigate(w(""));
    else void navigate(-1);
    // The note's content/preview may have changed in NoteView — refresh the list.
    void qc.invalidateQueries({ queryKey: keys.noteCards });
  }

  // BUG-54: these three leave the note screen without being *about* the note, so each must
  // ask before unmounting a recording.
  //
  // Source state vs destination state decides what waits. Closing the sidebar belongs to
  // the CLICK (source) — on mobile it is an overlay whose scrim would dim and block the
  // very "Still recording" confirm the guard just raised — so it happens immediately.
  // Anything belonging to where you are GOING (the folder preview) waits for the leave.
  function handleUnfiledSelect() {
    setSidebarOpen(false);
    requestLeave(() => void navigate(w("/folders/unfiled")), "go to Unfiled");
  }

  function handleFolderSelect(folderId: string, folderPath: string[]) {
    setSidebarOpen(false);
    const folderName = folderPath[folderPath.length - 1] ?? "";
    requestLeave(() => {
      void navigate(w(`/folders/${folderId}`));
      setPreviewFolderId(folderId);
      setPreviewFolderName(folderName);
    }, `go to ${folderName || "that folder"}`);
  }

  function handleHome() {
    requestLeave(() => void navigate(w("")), "go to Home");
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
    if (activeFolderId === folderId) void navigate(w(""));
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
      onNewNote={() => void handleNewNote()}
      onEditNote={(noteId) => openNote(noteId)}
      onOpenNote={(noteId, title, isNew) => openNote(noteId, title, isNew)}
      onDeleteNote={handleDeleteNote}
      folderPath={activeFolderId ? activeFolderPath : undefined}
      currentFolderId={activeFolderId}
      onHome={handleHome}
      otherWorkspaces={otherWorkspaces}
      onMoveNoteToWorkspace={handleMoveNoteToWorkspace}
    />
  );

  return (
    // BUG-54: any descendant that navigates away from the note screen (the workspace
    // switcher today) consults the recording guard instead of calling `navigate` directly.
    <LeaveGuardContext value={requestLeave}>
      <div className={styles.appLayout}>
        <button
          data-testid="sidebar-toggle"
          className={styles.sidebarToggle}
          aria-label="Toggle sidebar"
          onClick={() => setSidebarOpen((o) => !o)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        {/* Decorative backdrop scrim, hidden from assistive tech; tap-to-close is a
            pointer convenience. The sidebar is toggled by the keyboard-accessible
            hamburger button above. */}
        <div
          aria-hidden="true"
          className={clsx(styles.sidebarOverlay, sidebarOpen && styles.sidebarOverlayOpen)}
          onClick={() => setSidebarOpen(false)}
        />
        <Sidebar
          open={sidebarOpen}
          onCreate={() => void handleNewNote()}
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
          // BUG-54: signing out unmounts everything, recording included. The confirm's
          // content flush is awaited before this runs, so the save lands before the token
          // is cleared.
          onSignOut={() => requestLeave(signOut, "sign out")}
        />
        <FolderPreviewPanel
          folderId={previewFolderId}
          folderName={previewFolderName}
          cards={cards}
          onClose={() => setPreviewFolderId(null)}
          // Closing the preview is the destination's business, so it waits for the leave —
        // declining must leave the panel exactly as it was.
        onEditNote={(noteId) => openNote(noteId, undefined, false, () => setPreviewFolderId(null))}
          onDropNote={(noteId) => handleMoveNoteToFolder(noteId, previewFolderId === UNFILED_ID ? null : previewFolderId)}
        />
        <div className={styles.appMain}>
          {activeNoteId && (
            <OpenNoteTabs
              tabs={openNoteTabs}
              activeNoteId={activeNoteId}
              reconciled={cardsLoaded}
              onSelect={handleSelectTab}
              onClose={handleCloseTab}
            />
          )}
          <Routes>
            <Route index element={listView} />
            <Route path="folders/:folderId" element={listView} />
            <Route
              path="notes/:noteId"
              element={
                <NoteRoute
                  notes={cards}
                  onBack={handleBackFromNote}
                  onDelete={handleDelete}
                  onDateSet={handleDateSet}
                  onOpenNote={openNote}
                  onRegisterLeaveGuard={registerLeaveGuard}
                  otherWorkspaces={otherWorkspaces}
                  onMoveNoteToWorkspace={handleMoveNoteToWorkspace}
                />
              }
            />
            <Route path="*" element={<Navigate to={w("")} replace />} />
          </Routes>
        </div>
      </div>
    </LeaveGuardContext>
  );
}

function NoteRoute({
  notes,
  onBack,
  onDelete,
  onDateSet,
  onOpenNote,
  onRegisterLeaveGuard,
  otherWorkspaces,
  onMoveNoteToWorkspace,
}: {
  notes: { noteId: string; title: string }[];
  onBack: () => void;
  onDelete: (noteId: string) => Promise<void>;
  onDateSet: (noteId: string, date: string) => void;
  onOpenNote: (noteId: string, title?: string, isNew?: boolean) => void;
  onRegisterLeaveGuard: (
    guard: ((proceed: () => void, destination: string) => void) | null,
  ) => void;
  otherWorkspaces: { workspaceId: string; name: string }[];
  onMoveNoteToWorkspace: (noteId: string, workspaceId: string) => void;
}) {
  const { noteId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const wsId = useCurrentWorkspace();
  const { showError } = useToast();
  const requestLeave = useRequestLeave();
  const navState = location.state as NoteNavState | null;
  // A deep-link to a deleted/unknown note recovers to the workspace home with a
  // toast, and emits a RUM event so the rate of dead links is observable (21-C).
  const handleNotFound = useCallback(() => {
    recordRumEvent("deadNoteLink", { noteId });
    showError("That note no longer exists.");
    void navigate(`/w/${wsId}`, { replace: true });
  }, [noteId, navigate, showError, wsId]);
  if (!noteId) return <Navigate to={`/w/${wsId}`} replace />;
  return (
    <NoteView
      key={noteId}
      noteId={noteId}
      initialTitle={navState?.initialTitle ?? notes.find((n) => n.noteId === noteId)?.title ?? ""}
      onBack={onBack}
      onExit={() => void navigate(`/w/${wsId}`)}
      onDelete={onDelete}
      onDateSet={onDateSet}
      onOpenNote={onOpenNote}
      onRegisterLeaveGuard={onRegisterLeaveGuard}
      onNotFound={handleNotFound}
      isNew={navState?.isNew}
      otherWorkspaces={otherWorkspaces}
      // Moving from the note page navigates home: the note has left this workspace,
      // so it no longer belongs on this page (mirrors the card's optimistic removal).
      // BUG-54: unlike delete, the note SURVIVES the move — so losing the in-flight
      // transcript to it is pure loss, and the move waits for the leave confirmation.
      onMoveToWorkspace={(workspaceId) =>
        requestLeave(() => {
          onMoveNoteToWorkspace(noteId, workspaceId);
          void navigate(`/w/${wsId}`);
        }, `move this note to ${otherWorkspaces.find((ws) => ws.workspaceId === workspaceId)?.name ?? "another workspace"}`)
      }
    />
  );
}
