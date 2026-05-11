import { FolderNode } from "../api";

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
    <div className="folder-picker-section">
      <h2 className="folder-picker-heading">Folder</h2>
      <select
        className="folder-picker-select"
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
