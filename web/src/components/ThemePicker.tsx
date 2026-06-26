import { Theme } from "../hooks/useTheme";
import { useWorkspaceTheme } from "../hooks/useWorkspaceTheme";

import styles from "./ThemePicker.module.css";

const LIGHT_THEMES: { value: Theme; label: string }[] = [
  { value: "teal", label: "Teal" },
  { value: "indigo", label: "Indigo" },
  { value: "rose", label: "Rose" },
  { value: "amber", label: "Amber" },
  { value: "violet", label: "Violet" },
  { value: "sky", label: "Sky" },
  { value: "sepia", label: "Sepia" },
  { value: "contrast", label: "Contrast" },
  { value: "emerald", label: "Emerald" },
  { value: "fuchsia", label: "Fuchsia" },
  { value: "lime", label: "Lime" },
];

const DARK_THEMES: { value: Theme; label: string }[] = [
  { value: "midnight", label: "Midnight" },
  { value: "slate", label: "Slate" },
  { value: "carbon", label: "Carbon" },
  { value: "plum", label: "Plum" },
  { value: "pine", label: "Pine" },
  { value: "ocean", label: "Ocean" },
  { value: "ember", label: "Ember" },
];

export default function ThemePicker() {
  const { theme, setTheme } = useWorkspaceTheme();

  return (
    <div className={styles.themePicker}>
      <label className={styles.themePickerLabel} htmlFor="theme-select">
        Theme
      </label>
      <select
        id="theme-select"
        className={styles.themePickerSelect}
        value={theme}
        onChange={(e) => setTheme(e.target.value as Theme)}
      >
        <optgroup label="Light">
          {LIGHT_THEMES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Dark">
          {DARK_THEMES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}
