/**
 * Studio shell — the region skeleton from STUDIO-UI.md. Structure + token styling
 * only; each region's functional UI fills in as its phase lands. Chrome only:
 * everything here is theme-token-styled and never touches RN artboard content.
 */
import { useState } from "react";
import {
  childrenOf,
  findNode,
  findRootContaining,
  getParent,
  useDocumentStore,
  type NodeId,
  type RNPrimitive,
} from "@rn-canvas/document";
import { color, layout, radius, space, text } from "./studio-theme";
import { DocumentTree } from "./DocumentTree";

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

/** A quiet segmented tab bar used by the left panel and inspector. */
export function Tabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: string[];
  active: string;
  onSelect: (t: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: space.xs,
        padding: space.xs,
        background: color.chrome2,
        borderRadius: radius.base,
      }}
    >
      {tabs.map((t) => {
        const on = t === active;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onSelect(t)}
            style={{
              flex: 1,
              padding: `${space.xs} ${space.sm}`,
              border: "none",
              borderRadius: radius.sm,
              background: on ? color.raised : "transparent",
              color: on ? color.ink : color.inkDim,
              fontSize: text.xs,
              fontWeight: 600,
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

/** tldraw owns frame placement; every other tool inserts a document node. */
export function ToolRail({
  onSelect,
  onAddFrame,
  onAddPrimitive,
  canAddPrimitive,
}: {
  onSelect: () => void;
  onAddFrame: () => void;
  onAddPrimitive: (type: RNPrimitive) => void;
  canAddPrimitive: boolean;
}) {
  const tools: {
    glyph: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }[] = [
    { glyph: "⌖", label: "Select", onClick: onSelect },
    { glyph: "▭", label: "Frame", onClick: onAddFrame },
    { glyph: "□", label: "View", onClick: () => onAddPrimitive("View"), disabled: !canAddPrimitive },
    { glyph: "T", label: "Text", onClick: () => onAddPrimitive("Text"), disabled: !canAddPrimitive },
    { glyph: "▧", label: "Image", onClick: () => onAddPrimitive("Image"), disabled: !canAddPrimitive },
    { glyph: "◉", label: "Pressable", onClick: () => onAddPrimitive("Pressable"), disabled: !canAddPrimitive },
    { glyph: "↕", label: "ScrollView", onClick: () => onAddPrimitive("ScrollView"), disabled: !canAddPrimitive },
    { glyph: "▤", label: "TextInput", onClick: () => onAddPrimitive("TextInput"), disabled: !canAddPrimitive },
    { glyph: "☷", label: "FlatList", onClick: () => onAddPrimitive("FlatList"), disabled: !canAddPrimitive },
  ];
  return (
    <nav
      style={{
        flex: `0 0 ${layout.rail}px`,
        width: layout.rail,
        background: color.chrome,
        borderRight: `1px solid ${color.line}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: space.xs,
        padding: `${space.sm} 0`,
      }}
    >
      {tools.map((t) => {
        return (
          <button
            key={t.label}
            type="button"
            title={t.label}
            onClick={t.onClick}
            disabled={t.disabled}
            style={{
              width: 36,
              height: 36,
              borderRadius: radius.sm,
              border: `1px solid ${color.line}`,
              background: color.chrome2,
              color: t.disabled ? color.inkFaint : color.ink,
              fontSize: text.base,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {t.glyph}
          </button>
        );
      })}
    </nav>
  );
}

const panelButton: React.CSSProperties = {
  border: `1px solid ${color.line}`,
  borderRadius: radius.sm,
  padding: `${space.xs} ${space.sm}`,
  background: color.raised,
  color: color.ink,
  fontSize: text.sm,
};

/** Document navigation. Screens are roots; Layers is the focused root's tree. */
export function LeftPanel({ onAddFrame }: { onAddFrame: () => void }) {
  const [tab, setTab] = useState("Screens");
  const roots = useDocumentStore((state) => state.roots);
  const selection = useDocumentStore((state) => state.selection);
  const setSelection = useDocumentStore((state) => state.setSelection);
  const removeRoot = useDocumentStore((state) => state.removeRoot);
  const removeNode = useDocumentStore((state) => state.removeNode);
  const reorderChild = useDocumentStore((state) => state.reorderChild);
  const selectedId = selection[0] ?? null;
  const rootList = Object.values(roots);
  const focusedRoot = findRootContaining(rootList, selectedId ?? "");
  const selectedNode =
    focusedRoot && selectedId ? findNode(focusedRoot, selectedId) : undefined;
  const selectedParent =
    focusedRoot && selectedId ? getParent(focusedRoot, selectedId) : undefined;
  const selectedSiblings = selectedParent ? childrenOf(selectedParent) : [];
  const selectedIndex = selectedSiblings.findIndex((node) => node.id === selectedId);
  const canMoveUp = selectedIndex > 0 && !selectedNode?.design?.locked;
  const canMoveDown =
    selectedIndex >= 0 &&
    selectedIndex < selectedSiblings.length - 1 &&
    !selectedNode?.design?.locked;
  const canDeleteLayer =
    !!selectedId &&
    selectedId !== focusedRoot?.id &&
    !selectedNode?.design?.locked;

  function deleteScreen(rootId: NodeId) {
    const remaining = rootList.filter((root) => root.id !== rootId);
    removeRoot(rootId);
    setSelection(remaining[0] ? [remaining[0].id] : []);
  }

  function moveSelected(direction: -1 | 1) {
    if (!focusedRoot || !selectedId) return;
    const parent = getParent(focusedRoot, selectedId);
    if (!parent) return;
    const siblings = childrenOf(parent);
    const from = siblings.findIndex((node) => node.id === selectedId);
    const to = from + direction;
    if (to < 0 || to >= siblings.length) return;
    reorderChild(focusedRoot.id, parent.id, from, to);
  }

  function deleteSelected() {
    if (!focusedRoot || !selectedId || selectedId === focusedRoot.id) return;
    const parent = getParent(focusedRoot, selectedId);
    removeNode(focusedRoot.id, selectedId);
    setSelection(parent ? [parent.id] : [focusedRoot.id]);
  }

  return (
    <aside
      style={{
        flex: `0 0 ${layout.leftPanel}px`,
        width: layout.leftPanel,
        background: color.chrome,
        borderRight: `1px solid ${color.line}`,
        display: "flex",
        flexDirection: "column",
        gap: space.md,
        padding: space.md,
        overflowY: "auto",
      }}
    >
      <Tabs tabs={["Screens", "Layers"]} active={tab} onSelect={setTab} />
      {tab === "Screens" && (
        <section style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Eyebrow>Screens</Eyebrow>
            <button type="button" style={panelButton} onClick={onAddFrame} title="Add screen">
              +
            </button>
          </div>
          {rootList.map((root, index) => {
            const active = root.id === focusedRoot?.id;
            const locked = !!root.design?.locked;
            return (
              <div key={root.id} style={{ display: "flex", gap: space.xs }}>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => setSelection([root.id])}
                  style={{
                    ...panelButton,
                    flex: 1,
                    textAlign: "left",
                    background: active ? color.accent : color.chrome2,
                    color: root.design?.hidden ? color.inkFaint : color.ink,
                  }}
                >
                  {root.design?.name ?? `Screen ${index + 1}`}
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => deleteScreen(root.id)}
                  style={panelButton}
                  title="Delete screen"
                >
                  ×
                </button>
              </div>
            );
          })}
        </section>
      )}
      {tab === "Layers" && (
        <section style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
          <Eyebrow>Layers</Eyebrow>
          {focusedRoot ? (
            <>
              <div style={{ background: color.chrome2, borderRadius: radius.base, padding: space.xs }}>
                <DocumentTree
                  node={focusedRoot}
                  rootId={focusedRoot.id}
                  selectedId={selectedId}
                />
              </div>
              <div style={{ display: "flex", gap: space.xs }}>
                <button
                  type="button"
                  style={panelButton}
                  onClick={() => moveSelected(-1)}
                  disabled={!canMoveUp}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  style={panelButton}
                  onClick={() => moveSelected(1)}
                  disabled={!canMoveDown}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  style={panelButton}
                  onClick={deleteSelected}
                  disabled={!canDeleteLayer}
                  title="Delete layer"
                >
                  ×
                </button>
              </div>
            </>
          ) : (
            <p style={{ color: color.inkFaint, fontSize: text.sm, margin: 0 }}>
              Select a screen to inspect its layers.
            </p>
          )}
        </section>
      )}
    </aside>
  );
}
