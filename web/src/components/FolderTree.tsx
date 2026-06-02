import { useState } from "react";
import { FolderNode } from "../api";

interface NodeProps {
  node: FolderNode;
  activeFolderId?: string;
  path: string[];
  onSelect: (folderId: string, path: string[]) => void;
  onRename: (folderId: string, newName: string) => void;
  onDelete: (folderId: string) => void;
  onCreateChild: (parentFolderId: string, name: string) => void;
  onDropNote: (noteId: string, folderId: string) => void;
  onMoveFolder?: (folderId: string, parentFolderId: string | null) => void;
  previewFolderId: string | null;
  onPreview: (folderId: string, name: string) => void;
}

function FolderTreeNode({ node, activeFolderId, path, onSelect, onRename, onDelete, onCreateChild, onDropNote, onMoveFolder, previewFolderId, onPreview }: NodeProps) {
  const isPreviewing = node.folderId === previewFolderId;
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const [addingChild, setAddingChild] = useState(false);
  const [childName, setChildName] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [hovered, setHovered] = useState(false);

  const currentPath = [...path, node.name];
  const isActive = node.folderId === activeFolderId;

  function finishEdit() {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== node.name) onRename(node.folderId, trimmed);
    else setEditName(node.name);
    setEditing(false);
  }

  function submitChild() {
    const trimmed = childName.trim();
    if (trimmed) onCreateChild(node.folderId, trimmed);
    setChildName("");
    setAddingChild(false);
  }

  return (
    <li
      className="folder-tree-node"
      data-testid={`folder-item-${node.folderId}`}
    >
      <div
        className={`folder-tree-node-row${isActive ? " folder-tree-node-row--active" : ""}${isDragOver ? " folder-tree-node-row--drag-over" : ""}${hovered ? " folder-tree-node-row--hovered" : ""}`}
        draggable={!!onMoveFolder}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("application/folder-id", node.folderId);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
        onDragEnter={() => setIsDragOver(true)}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(false);
          const droppedFolderId = e.dataTransfer.getData("application/folder-id");
          if (droppedFolderId && onMoveFolder) {
            onMoveFolder(droppedFolderId, node.folderId);
            return;
          }
          const noteId = e.dataTransfer.getData("text/plain");
          if (noteId) onDropNote(noteId, node.folderId);
        }}
      >
        <button
          className="folder-tree-expand"
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? "Collapse folder" : "Expand folder"}
        >
          {node.children.length > 0 || addingChild ? (expanded ? "▾" : "▸") : "·"}
        </button>
        {editing ? (
          <input
            className="folder-tree-rename-input"
            value={editName}
            autoFocus
            onChange={(e) => setEditName(e.target.value)}
            onBlur={finishEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") finishEdit();
              if (e.key === "Escape") { setEditName(node.name); setEditing(false); }
            }}
            aria-label="Rename folder"
          />
        ) : (
          <button
            className="folder-tree-name"
            data-testid={`folder-name-${node.folderId}`}
            onClick={() => { onSelect(node.folderId, currentPath); setExpanded(true); }}
            onDoubleClick={() => { setEditing(true); setEditName(node.name); }}
          >
            {node.name}
          </button>
        )}
        <div className="folder-tree-actions">
          <button
            className="folder-tree-action-btn"
            onClick={(e) => { e.stopPropagation(); onPreview(node.folderId, node.name); }}
            title={isPreviewing ? "Close folder preview" : "Preview notes"}
            aria-label={isPreviewing ? "Close folder preview" : "Preview folder notes"}
          >
            {isPreviewing ? "«" : "»"}
          </button>
          <button
            className="folder-tree-action-btn"
            data-testid="add-subfolder-button"
            onClick={() => { setAddingChild(true); setExpanded(true); }}
            title="New subfolder"
            aria-label="Add subfolder"
          >
            +
          </button>
          <button
            className="folder-tree-action-btn"
            onClick={() => { setEditName(node.name); setEditing(true); }}
            title="Rename"
            aria-label="Rename folder"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          </button>
          <button
            className="folder-tree-action-btn folder-tree-action-btn--delete"
            onClick={() => onDelete(node.folderId)}
            title="Delete"
            aria-label="Delete folder"
          >
            ×
          </button>
        </div>
      </div>
      {(expanded || addingChild) && (
        <ul className="folder-tree-children">
          {expanded && node.children.map((child) => (
            <FolderTreeNode
              key={child.folderId}
              node={child}
              activeFolderId={activeFolderId}
              path={currentPath}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
              onCreateChild={onCreateChild}
              onDropNote={onDropNote}
              onMoveFolder={onMoveFolder}
              previewFolderId={previewFolderId}
              onPreview={onPreview}
            />
          ))}
          {addingChild && (
            <li className="folder-tree-node">
              <div className="folder-tree-node-row">
                <span className="folder-tree-expand">·</span>
                <input
                  className="folder-tree-rename-input"
                  data-testid="subfolder-input"
                  value={childName}
                  autoFocus
                  placeholder="Subfolder name…"
                  onChange={(e) => setChildName(e.target.value)}
                  onBlur={submitChild}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitChild();
                    if (e.key === "Escape") { setChildName(""); setAddingChild(false); }
                  }}
                  aria-label="New subfolder name"
                />
              </div>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

export default function FolderTree({
  nodes,
  activeFolderId,
  onSelect,
  onRename,
  onDelete,
  onCreateChild,
  onDropNote,
  onMoveFolder,
  previewFolderId,
  onPreview,
}: {
  nodes: FolderNode[];
  activeFolderId?: string;
  onSelect: (folderId: string, path: string[]) => void;
  onRename: (folderId: string, newName: string) => void;
  onDelete: (folderId: string) => void;
  onCreateChild: (parentFolderId: string, name: string) => void;
  onDropNote: (noteId: string, folderId: string) => void;
  onMoveFolder?: (folderId: string, parentFolderId: string | null) => void;
  previewFolderId: string | null;
  onPreview: (folderId: string, name: string) => void;
}) {
  if (nodes.length === 0) return null;

  return (
    <ul className="folder-tree">
      {nodes.map((node) => (
        <FolderTreeNode
          key={node.folderId}
          node={node}
          activeFolderId={activeFolderId}
          path={[]}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
          onCreateChild={onCreateChild}
          onDropNote={onDropNote}
          onMoveFolder={onMoveFolder}
          previewFolderId={previewFolderId}
          onPreview={onPreview}
        />
      ))}
    </ul>
  );
}
