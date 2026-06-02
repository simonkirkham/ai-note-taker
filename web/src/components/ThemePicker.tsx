import { Theme, useTheme } from "../hooks/useTheme";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "teal", label: "Teal" },
  { value: "forest", label: "Forest" },
  { value: "midnight", label: "Midnight" },
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
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
