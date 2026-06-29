import { useCallback, useState } from "react";

export type Theme =
  | "teal"
  | "indigo"
  | "rose"
  | "amber"
  | "violet"
  | "sky"
  | "emerald"
  | "steel"
  | "midnight"
  | "slate"
  | "plum"
  | "pine"
  | "ocean"
  | "ember"
  | "obsidian"
  | "graphite"
  | "deepsea";

const STORAGE_KEY = "note-taker-theme";
export const THEMES: readonly Theme[] = [
  "teal",
  "indigo",
  "rose",
  "amber",
  "violet",
  "sky",
  "emerald",
  "steel",
  "midnight",
  "slate",
  "plum",
  "pine",
  "ocean",
  "ember",
  "obsidian",
  "graphite",
  "deepsea",
];
export const DEFAULT_THEME: Theme = "teal";

// Reads the persisted theme, falling back to Teal for a missing or
// unrecognised value. Mirrors the inline bootstrap in index.html.
export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (THEMES as readonly string[]).includes(stored)) {
      return stored as Theme;
    }
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_THEME;
}

// Teal is the :root default, so it carries no data-theme attribute; the other
// themes set it. This swaps the whole palette through the CSS cascade.
export function applyTheme(theme: Theme): void {
  if (theme === DEFAULT_THEME) {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* localStorage unavailable — apply for this session only */
    }
    applyTheme(next);
  }, []);

  return { theme, setTheme };
}
