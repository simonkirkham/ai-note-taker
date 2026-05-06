import { useCallback, useEffect, useRef, useState } from "react";
import {
  createNote as apiCreate,
  listNotes as apiList,
  renameNote as apiRename,
  deleteNote as apiDelete,
  NoteItem,
} from "../api";

export function useNotes() {
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const notesRef = useRef(notes);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    let mounted = true;
    apiList()
      .then((items) => {
        if (mounted) setNotes(items);
      })
      .catch(() => {
        /* ignore for now, App can show empty state */
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const create = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const { noteId } = await apiCreate();
      setNotes((prev) => [...prev, { noteId, title: "" }]);
      return noteId;
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create note");
      throw e;
    } finally {
      setCreating(false);
    }
  }, []);

  const rename = useCallback(async (noteId: string, title: string) => {
    const previous =
      notesRef.current.find((n) => n.noteId === noteId)?.title ?? "";

    setNotes((prev) =>
      prev.map((n) => (n.noteId === noteId ? { ...n, title } : n)),
    );

    try {
      await apiRename(noteId, title);
    } catch {
      setNotes((prev) =>
        prev.map((n) => (n.noteId === noteId ? { ...n, title: previous } : n)),
      );
      throw new Error("rename failed");
    }
  }, []);

  const remove = useCallback(async (noteId: string) => {
    await apiDelete(noteId);
    setNotes((prev) => prev.filter((n) => n.noteId !== noteId));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await apiList();
      setNotes(items);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    notes,
    loading,
    creating,
    createError,
    create,
    rename,
    remove,
    refresh,
  };
}
