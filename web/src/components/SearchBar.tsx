import { SearchIcon } from "./icons";
import styles from "./SearchBar.module.css";

export default function SearchBar({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className={styles.searchBar}>
      <span className={styles.searchIcon} aria-hidden="true">
        <SearchIcon />
      </span>
      <input
        type="search"
        className={styles.searchInput}
        aria-label="Search notes"
        placeholder="Search notes…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value !== "" && (
        <button
          type="button"
          className={styles.clearButton}
          aria-label="Clear search"
          onClick={onClear}
        >
          ✕
        </button>
      )}
    </div>
  );
}
