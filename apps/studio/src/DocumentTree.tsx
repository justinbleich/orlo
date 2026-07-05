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
import { ChevronDown, ChevronRight, Component, Eye, EyeOff, Lock, LockOpen } from "lucide-react";
import { color, radius, space, text } from "./studio-theme";
import { normalizeNodeSelection, selectionRange } from "./selection";
import { draggedBlock, resolveDrop, type DropZone } from "./layer-tree-model";
import { useStudioStore } from "./studio-store";
import { cn } from "./studio-ui";

// One drag at a time; module-scoped so every recursive row shares it. Holds the
// full dragged block: dragging a row that's part of the selection moves the
// whole selection.
let draggedNodeIds: NodeId[] = [];

function performDrop(rootId: NodeId, targetId: NodeId, zone: DropZone) {
  const store = useDocumentStore.getState();
  const root = store.roots[rootId];
  if (!root) return;
  const drop = resolveDrop(root, targetId, zone, draggedNodeIds);
  if (!drop) return;
  store.beginInteraction();
  try {
    draggedNodeIds.forEach((id, offset) => {
      useDocumentStore.getState().moveNode(rootId, id, drop.parentId, drop.index + offset);
    });
    useDocumentStore.getState().commitInteraction();
    useDocumentStore.getState().setSelection([...draggedNodeIds]);
  } catch {
    useDocumentStore.getState().cancelInteraction();
  }
}

function zoneForPointer(event: React.DragEvent<HTMLDivElement>, container: boolean): DropZone {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
  if (ratio < (container ? 0.3 : 0.5)) return "before";
  if (container && ratio < 0.7) return "into";
  return "after";
}

/** 24px hover targets that read as 13px glyphs. */
const rowActionStyle: React.CSSProperties = {
  border: 0,
  padding: 0,
  width: 18,
  height: 18,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  color: "inherit",
  borderRadius: 4,
  flexShrink: 0,
};

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
  const components = useDocumentStore((state) => state.components);
  const collapsed = useStudioStore((state) => !!state.collapsedLayers[node.id]);
  const toggleCollapsed = useStudioStore((state) => state.toggleLayerCollapsed);
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const selected = selectedIds.includes(node.id);
  const locked = !!node.design?.locked;
  const hidden = !!node.design?.hidden;
  const isRoot = depth === 0;
  const isInstance = node.type === "ComponentInstance";
  const componentName =
    node.type === "ComponentInstance" ? components[node.componentId]?.name : undefined;
  const label = node.design?.name ?? componentName ?? node.type;
  const typeHint = isRoot ? "screen root" : isInstance ? "instance" : node.type;
  const children = childrenOf(node);
  const container = isContainer(node);
  const expanded = !collapsed;
  const title = `${label} · ${typeHint} · ${node.id}`;

  function commitRename() {
    if (renaming !== null) {
      const name = renaming.trim();
      try {
        updateDesign(rootId, node.id, { name: name.length > 0 ? name : undefined });
      } catch {
        /* invalid name — keep the old one */
      }
    }
    setRenaming(null);
  }

  const showLine = dropZone === "before" || dropZone === "after";

  return (
    <>
      <div
        data-layer-id={node.id}
        data-layer-type={node.type}
        title={title}
        draggable={!locked && depth > 0 && renaming === null}
        onDragStart={(event) => {
          const root = useDocumentStore.getState().roots[rootId];
          draggedNodeIds = root ? draggedBlock(root, node.id, selectedIds) : [node.id];
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => {
          if (draggedNodeIds.length === 0 || draggedNodeIds.includes(node.id)) return;
          event.preventDefault();
          setDropZone(zoneForPointer(event, container));
        }}
        onDragLeave={() => setDropZone(null)}
        onDrop={(event) => {
          event.preventDefault();
          const zone = dropZone ?? zoneForPointer(event, container);
          setDropZone(null);
          performDrop(rootId, node.id, zone);
          draggedNodeIds = [];
        }}
        onDragEnd={() => {
          draggedNodeIds = [];
          setDropZone(null);
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (!locked) setRenaming(label);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          useStudioStore.getState().openLayerMenu({
            rootId,
            nodeId: node.id,
            x: event.clientX,
            y: event.clientY,
          });
        }}
        onClick={(event) => {
          if (locked || renaming !== null) return;
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
          position: "relative",
          padding: `${space.xs} ${space.sm}`,
          paddingLeft: `calc(${space.sm} + ${depth} * ${space.md})`,
          cursor: locked ? "not-allowed" : "pointer",
          fontSize: text.sm,
          background: selected || dropZone === "into" ? color.accentSoft : "transparent",
          color: hidden ? color.inkFaint : selected ? color.accent : color.ink,
          borderRadius: radius.sm,
          boxShadow:
            selected || dropZone === "into" ? `inset 0 0 0 1px ${color.accentLine}` : "none",
          display: "flex",
          alignItems: "center",
          gap: space.xs,
        }}
      >
        {/* Insertion indicator: a 2px accent line above/below the row. */}
        {showLine && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: `calc(${space.sm} + ${depth} * ${space.md})`,
              right: 4,
              height: 2,
              borderRadius: 1,
              background: color.accent,
              ...(dropZone === "before" ? { top: -1 } : { bottom: -1 }),
              pointerEvents: "none",
            }}
          />
        )}
        {children.length > 0 ? (
          <button
            type="button"
            title={expanded ? "Collapse layer" : "Expand layer"}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              toggleCollapsed(node.id);
            }}
            style={{ ...rowActionStyle, width: 16, height: 16 }}
          >
            {expanded ? (
              <ChevronDown size={13} aria-hidden="true" />
            ) : (
              <ChevronRight size={13} aria-hidden="true" />
            )}
          </button>
        ) : (
          <span style={{ width: 16, height: 16, flexShrink: 0 }} aria-hidden="true" />
        )}
        {isInstance && (
          <Component size={13} aria-hidden="true" style={{ color: color.accent, flexShrink: 0 }} />
        )}
        {renaming !== null ? (
          <input
            autoFocus
            value={renaming}
            onChange={(event) => setRenaming(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") setRenaming(null);
            }}
            onClick={(event) => event.stopPropagation()}
            style={{
              minWidth: 0,
              flex: 1,
              border: `1px solid ${color.accentLine}`,
              borderRadius: 4,
              background: color.chrome,
              color: color.ink,
              fontSize: text.sm,
              padding: "0 4px",
              outline: "none",
            }}
          />
        ) : (
          <span className={cn("min-w-0 flex-1 truncate")}>
            {label}
            {(isRoot || isInstance) && (
              <span style={{ color: color.inkFaint }}> · {typeHint}</span>
            )}
          </span>
        )}
        {/* Hover affordances; hidden/locked stay visible as state. */}
        {(hovered || hidden) && depth > 0 && renaming === null && (
          <button
            type="button"
            title={hidden ? "Show layer" : "Hide layer"}
            onClick={(event) => {
              event.stopPropagation();
              updateDesign(rootId, node.id, { hidden: hidden ? undefined : true });
            }}
            style={{ ...rowActionStyle, opacity: hidden ? 1 : 0.7 }}
          >
            {hidden ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
          </button>
        )}
        {(hovered || locked) && depth > 0 && renaming === null && (
          <button
            type="button"
            title={locked ? "Unlock layer" : "Lock layer"}
            onClick={(event) => {
              event.stopPropagation();
              updateDesign(rootId, node.id, { locked: locked ? undefined : true });
            }}
            style={{ ...rowActionStyle, opacity: locked ? 1 : 0.7 }}
          >
            {locked ? <Lock size={13} aria-hidden="true" /> : <LockOpen size={13} aria-hidden="true" />}
          </button>
        )}
      </div>
      {expanded && children.map((child) => (
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
