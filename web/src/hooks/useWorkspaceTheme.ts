import { useCallback, useEffect } from "react";
import { useCurrentWorkspace } from "../workspace/context";
import { DEFAULT_WORKSPACE_ID } from "../workspace/workspaceStore";
import { applyTheme, DEFAULT_THEME, useTheme, type Theme } from "./useTheme";
import { useSetWorkspaceTheme } from "./useWorkspaceMutations";
import { useWorkspaces } from "./useWorkspaces";

// Per-workspace theme. The default workspace keeps the global localStorage theme;
// a non-default workspace stores its theme server-side and applies it on switch.
export function useWorkspaceTheme() {
  const workspaceId = useCurrentWorkspace();
  const isDefault = workspaceId === DEFAULT_WORKSPACE_ID;
  const { data: workspaces } = useWorkspaces();
  const { theme: globalTheme, setTheme: setGlobalTheme } = useTheme();
  const setWorkspaceThemeMutation = useSetWorkspaceTheme();

  const current = workspaces?.find((w) => w.workspaceId === workspaceId);
  // null = not yet known (non-default, list still loading) → leave the bootstrap-applied theme untouched.
  const effective: Theme | null = isDefault
    ? globalTheme
    : workspaces === undefined
      ? null
      : (current?.theme ?? DEFAULT_THEME);

  useEffect(() => {
    if (effective === null) return;
    applyTheme(effective);
    if (!isDefault) {
      // Cache the resolved theme keyed by workspace so the index.html bootstrap can paint it
      // pre-mount on a cold load (36-B), avoiding a flash of the global/default theme. Key format
      // `note-taker-theme:<wsId>` is mirrored in index.html's bootstrap — keep the two in sync.
      try {
        localStorage.setItem(`note-taker-theme:${workspaceId}`, effective);
      } catch {
        /* localStorage unavailable */
      }
    }
  }, [effective, isDefault, workspaceId]);

  const setTheme = useCallback(
    (next: Theme) => {
      if (isDefault) {
        setGlobalTheme(next);
        return;
      }
      // The optimistic cache write (mutation onMutate) drives `effective`, and the effect is the
      // sole writer of the DOM theme — so a rollback on error reliably re-applies the prior theme.
      setWorkspaceThemeMutation.mutate({ workspaceId, theme: next });
    },
    [isDefault, workspaceId, setGlobalTheme, setWorkspaceThemeMutation],
  );

  return { theme: effective ?? DEFAULT_THEME, setTheme };
}
