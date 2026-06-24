import { useState } from "react";
import {
  childrenOf,
  findNode,
  getParent,
  isContainer,
  useDocumentStore,
  type Node,
  type NodeId,
} from "@rn-canvas/document";
import { EyeOff, LockOpen } from "lucide-react";
import { color, radius, space, text } from "./studio-theme";
import { normalizeNodeSelection, selectionRange } from "./selection";

// One drag at a time; module-scoped so every recursive row shares it.
let draggedNodeId: NodeId | null = null;

/**
 * Move the dragged node relative to a drop target: onto a container reparents it
 * (appended); onto a leaf makes it that leaf's next sibling. Guards self/descendant
 * drops (moveNode also throws on those) and fixes the index for same-parent moves,
 * since moveNode removes the node before re-inserting.
 */
function dropOnto(rootId: NodeId, target: Node) {
  const dragged = draggedNodeId;
  if (!dragged || dragged === target.id) return;
  const store = useDocumentStore.getState();
  const root = store.roots[rootId];
  if (!root || dragged === root.id) return;
  const draggedNode = findNode(root, dragged);
  if (!draggedNode || findNode(draggedNode, target.id)) return; // can't drop into own subtree

  let parentId: NodeId;
  let index: number;
  if (isContainer(target)) {
    parentId = target.id;
    index = childrenOf(target).length;
  } else {
    const parent = getParent(root, target.id);
    if (!parent) return;
    parentId = parent.id;
    const sibs = childrenOf(parent);
    const targetIdx = sibs.findIndex((s) => s.id === target.id);
    const draggedIdx = sibs.findIndex((s) => s.id === dragged);
    index = targetIdx + 1;
    if (draggedIdx !== -1 && draggedIdx < targetIdx) index -= 1; // removal shifts target down
  }
  try {
    store.moveNode(rootId, dragged, parentId, index);
    store.setSelection([dragged]);
  } catch {
    /* invalid move (e.g. into own descendant) — ignore */
  }
}

export function DocumentTree({
  node,
  rootId,
  selectedIds,
  depth = 0,
}: {
  node: Node;
  rootId: NodeId;
  selectedIds: readonly NodeId[];
  depth?: number;
}) {
  const setSelection = useDocumentStore((state) => state.setSelection);
  const updateDesign = useDocumentStore((state) => state.updateDesign);
  const [over, setOver] = useState(false);
  const selected = selectedIds.includes(node.id);
  const locked = !!node.design?.locked;
  const label = node.design?.name ?? node.type;

  return (
    <>
      <div
        draggable={!locked && depth > 0}
        onDragStart={(event) => {
          draggedNodeId = node.id;
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => {
          if (draggedNodeId && draggedNodeId !== node.id) {
            event.preventDefault();
            if (!over) setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          dropOnto(rootId, node);
          draggedNodeId = null;
        }}
        onDragEnd={() => {
          draggedNodeId = null;
          setOver(false);
        }}
        onClick={(event) => {
          if (locked) return;
          const root = useDocumentStore.getState().roots[rootId];
          if (!root) return;
          if (event.shiftKey && selectedIds.length > 0) {
            setSelection(selectionRange(root, selectedIds[selectedIds.length - 1], node.id));
          } else if (event.metaKey || event.ctrlKey) {
            const next = selected
              ? selectedIds.filter((id) => id !== node.id)
              : [...selectedIds, node.id];
            setSelection(normalizeNodeSelection(root, next));
          } else {
            setSelection([node.id]);
          }
        }}
        style={{
          padding: `${space.xs} ${space.sm}`,
          paddingLeft: `calc(${space.sm} + ${depth} * ${space.md})`,
          cursor: locked ? "not-allowed" : "pointer",
          fontSize: text.sm,
          background: selected ? color.accent : over ? color.accentSoft : "transparent",
          color: node.design?.hidden ? color.inkFaint : color.ink,
          borderRadius: radius.sm,
          boxShadow: over ? `inset 0 0 0 1px ${color.accentLine}` : "none",
          display: "flex",
          alignItems: "center",
          gap: space.xs,
        }}
      >
        {locked && (
          <button
            type="button"
            title="Unlock"
            onClick={(event) => {
              event.stopPropagation();
              updateDesign(rootId, node.id, { locked: false });
            }}
            style={{
              border: 0,
              padding: 0,
              width: 16,
              height: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              color: "inherit",
            }}
          >
            <LockOpen size={13} aria-hidden="true" />
          </button>
        )}
        {node.design?.hidden && <EyeOff size={13} aria-label="Hidden" />}
        <span>
          {label} <span style={{ color: color.inkFaint }}>· {node.type}</span>
        </span>
      </div>
      {childrenOf(node).map((child) => (
        <DocumentTree
          key={child.id}
          node={child}
          rootId={rootId}
          selectedIds={selectedIds}
          depth={depth + 1}
        />
      ))}
    </>
  );
}
