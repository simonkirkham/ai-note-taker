import { FolderNode } from "../api/folders";

import styles from "./FolderPicker.module.css";

function flatten(
  nodes: FolderNode[],
  depth = 0
): { folderId: string; label: string }[] {
  return nodes.flatMap((n) => [
    { folderId: n.folderId, label: " ".repeat(depth * 3) + n.name },
    ...flatten(n.children, depth + 1),
  ]);
}

export default function FolderPicker({
  folders,
  assignedFolderId,
  onMove,
}: {
  folders: FolderNode[];
  assignedFolderId: string | null;
  onMove: (folderId: string | null) => void;
}) {
  const options = flatten(folders);

  return (
    <div className={styles.folderPickerSection}>
      <h2 className={styles.folderPickerHeading}>Folder</h2>
      <select
        className={styles.folderPickerSelect}
        value={assignedFolderId ?? ""}
        onChange={(e) => onMove(e.target.value || null)}
      >
        <option value="">— Unfiled —</option>
        {options.map((o) => (
          <option key={o.folderId} value={o.folderId}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
