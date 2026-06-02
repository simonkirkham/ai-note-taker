import { Theme, useTheme } from "../hooks/useTheme";

const LIGHT_THEMES: { value: Theme; label: string }[] = [
  { value: "teal", label: "Teal" },
  { value: "indigo", label: "Indigo" },
  { value: "rose", label: "Rose" },
  { value: "amber", label: "Amber" },
  { value: "violet", label: "Violet" },
  { value: "sky", label: "Sky" },
  { value: "sepia", label: "Sepia" },
  { value: "contrast", label: "Contrast" },
];

const DARK_THEMES: { value: Theme; label: string }[] = [
  { value: "midnight", label: "Midnight" },
  { value: "slate", label: "Slate" },
  { value: "carbon", label: "Carbon" },
  { value: "plum", label: "Plum" },
];

export default function ThemePicker() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="theme-picker">
      <label className="theme-picker-label" htmlFor="theme-select">
        Theme
      </label>
      <select
        id="theme-select"
        className="theme-picker-select"
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
