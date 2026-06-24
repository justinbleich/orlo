/**
 * Studio shell — the region skeleton from STUDIO-UI.md. Structure + token styling
 * only; each region's functional UI fills in as its phase lands. Chrome only:
 * everything here is theme-token-styled and never touches RN artboard content.
 */
import { useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Frame,
  Image,
  List,
  MousePointer2,
  MousePointerClick,
  MoveVertical,
  Plus,
  Square,
  TextCursorInput,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import {
  childrenOf,
  findNode,
  findRootContaining,
  getParent,
  useDocumentStore,
  type NodeId,
  type RNPrimitive,
} from "@rn-canvas/document";
import { Menu } from "@base-ui/react/menu";
import { color, layout, radius, space, text } from "./studio-theme";
import { useStudioStore } from "./studio-store";
import { cn } from "./studio-ui";
import { DocumentTree } from "./DocumentTree";
import { deleteNodes, reorderNode } from "./document-actions";

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

type RailTool = { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean };
type InsertItem = { icon: LucideIcon; label: string; type: RNPrimitive };

/** Semantic primitives that live behind the Insert menu rather than the rail —
 *  keeps the rail to the core authoring tools (parity with Figma's lean rail). */
const INSERT_ITEMS: InsertItem[] = [
  { icon: MousePointerClick, label: "Pressable", type: "Pressable" },
  { icon: MoveVertical, label: "ScrollView", type: "ScrollView" },
  { icon: TextCursorInput, label: "TextInput", type: "TextInput" },
  { icon: List, label: "FlatList", type: "FlatList" },
];

const railButton =
  "flex size-9 items-center justify-center rounded-sm border border-line bg-chrome-2 text-ink " +
  "transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line " +
  "disabled:cursor-not-allowed disabled:bg-chrome-2 disabled:text-ink-faint disabled:hover:bg-chrome-2";
const railButtonActive = "border-accent-line bg-accent-soft text-accent hover:bg-accent-soft";

/**
 * tldraw owns frame placement; every creation tool *arms* a primitive, which the
 * next canvas drag draws as a node. The rail carries the core tools (Select,
 * Frame, View, Text, Image); the remaining semantic primitives sit in the Insert
 * menu so the rail stays uncluttered.
 */
export function ToolRail({
  onSelect,
  onAddFrame,
  canAddPrimitive,
}: {
  onSelect: () => void;
  onAddFrame: () => void;
  canAddPrimitive: boolean;
}) {
  const armedTool = useStudioStore((s) => s.armedTool);
  const setArmedTool = useStudioStore((s) => s.setArmedTool);
  const arm = (type: RNPrimitive) => setArmedTool(armedTool === type ? null : type);

  const tools: (RailTool & { active?: boolean })[] = [
    {
      icon: MousePointer2,
      label: "Select",
      onClick: () => {
        setArmedTool(null);
        onSelect();
      },
      active: armedTool === null,
    },
    { icon: Frame, label: "Frame", onClick: () => { setArmedTool(null); onAddFrame(); } },
    { icon: Square, label: "View", onClick: () => arm("View"), active: armedTool === "View", disabled: !canAddPrimitive },
    { icon: Type, label: "Text", onClick: () => arm("Text"), active: armedTool === "Text", disabled: !canAddPrimitive },
    { icon: Image, label: "Image", onClick: () => arm("Image"), active: armedTool === "Image", disabled: !canAddPrimitive },
  ];
  return (
    <nav className="studio-chrome flex w-[var(--w-rail)] shrink-0 flex-col items-center gap-xs border-r border-line bg-chrome py-sm">
      {tools.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.label}
            type="button"
            title={t.label}
            aria-label={t.label}
            aria-pressed={t.active}
            onClick={t.onClick}
            disabled={t.disabled}
            className={cn(railButton, t.active && railButtonActive)}
          >
            <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        );
      })}
      <div className="my-xs h-px w-5 bg-line" aria-hidden="true" />
      <InsertMenu armedTool={armedTool} onArm={arm} disabled={!canAddPrimitive} />
    </nav>
  );
}

/** Insert menu for the semantic primitives. Disabled until a frame is focused. */
function InsertMenu({
  armedTool,
  onArm,
  disabled,
}: {
  armedTool: RNPrimitive | null;
  onArm: (type: RNPrimitive) => void;
  disabled: boolean;
}) {
  const armedInMenu = INSERT_ITEMS.some((i) => i.type === armedTool);
  return (
    <Menu.Root>
      <Menu.Trigger
        title="Insert…"
        aria-label="Insert element"
        disabled={disabled}
        className={cn(
          railButton,
          armedInMenu && railButtonActive,
          "data-[popup-open]:bg-raised data-[popup-open]:ring-2 data-[popup-open]:ring-accent-line",
        )}
      >
        <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="right" align="start" sideOffset={8} className="z-50">
          <Menu.Popup className="studio-popup min-w-44 rounded-md border border-line bg-chrome p-control shadow-popover outline-none">
            <div className="eyebrow px-sm py-xs">Insert</div>
            {INSERT_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <Menu.Item
                  key={item.type}
                  onClick={() => onArm(item.type)}
                  className={cn(
                    "flex cursor-default items-center gap-sm rounded-sm px-sm py-menu-y text-sm outline-none data-[highlighted]:bg-raised data-[highlighted]:text-ink",
                    item.type === armedTool ? "text-accent" : "text-ink-dim",
                  )}
                >
                  <Icon size={15} strokeWidth={1.75} aria-hidden="true" className="text-ink-faint" />
                  {item.label}
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
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

const panelIconButton: React.CSSProperties = {
  ...panelButton,
  width: 28,
  height: 28,
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "0 0 auto",
};

function NavigatorSection({
  label,
  open,
  onToggle,
  action,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
      <div style={{ display: "flex", alignItems: "center", gap: space.xs }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          style={{
            border: 0,
            padding: 0,
            background: "transparent",
            color: color.inkFaint,
            display: "flex",
            alignItems: "center",
            gap: space.xs,
            flex: 1,
            textAlign: "left",
          }}
        >
          <Chevron size={13} aria-hidden="true" />
          <Eyebrow>{label}</Eyebrow>
        </button>
        {action}
      </div>
      {open && children}
    </section>
  );
}

/** Document navigation. Screens and the focused root's Layers stay visible together. */
export function LeftPanel({ onAddFrame }: { onAddFrame: () => void }) {
  const [screensOpen, setScreensOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(true);
  const roots = useDocumentStore((state) => state.roots);
  const selection = useDocumentStore((state) => state.selection);
  const setSelection = useDocumentStore((state) => state.setSelection);
  const removeRoot = useDocumentStore((state) => state.removeRoot);
  const selectedId = selection[0] ?? null;
  const rootList = Object.values(roots);
  const focusedRoot = findRootContaining(rootList, selectedId ?? "");
  const selectedNode =
    focusedRoot && selectedId ? findNode(focusedRoot, selectedId) : undefined;
  const selectedParent =
    focusedRoot && selectedId ? getParent(focusedRoot, selectedId) : undefined;
  const selectedSiblings = selectedParent ? childrenOf(selectedParent) : [];
  const selectedIndex = selectedSiblings.findIndex((node) => node.id === selectedId);
  const parentDirection = selectedParent?.style.flexDirection ?? "column";
  const horizontal = parentDirection.startsWith("row");
  const reverse = parentDirection.endsWith("reverse");
  const isFlowChild = selectedNode?.style.position !== "absolute";
  const canMoveBefore = selectedIndex > 0 && !selectedNode?.design?.locked && isFlowChild;
  const canMoveAfter =
    selectedIndex >= 0 &&
    selectedIndex < selectedSiblings.length - 1 &&
    !selectedNode?.design?.locked &&
    isFlowChild;
  const canDeleteLayer =
    !!selectedId &&
    selectedId !== focusedRoot?.id &&
    !selectedNode?.design?.locked;

  function deleteScreen(rootId: NodeId) {
    const remaining = rootList.filter((root) => root.id !== rootId);
    removeRoot(rootId);
    setSelection(remaining[0] ? [remaining[0].id] : []);
  }

  function moveSelected(offset: -1 | 1) {
    if (!focusedRoot || !selectedId) return;
    reorderNode(focusedRoot.id, selectedId, offset);
  }

  function deleteSelected() {
    if (!focusedRoot || !selectedId || selectedId === focusedRoot.id) return;
    deleteNodes(focusedRoot.id, [selectedId]);
  }

  return (
    <aside
      className="studio-chrome"
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
      <NavigatorSection
        label="Screens"
        open={screensOpen}
        onToggle={() => setScreensOpen((open) => !open)}
        action={
          <button type="button" style={panelIconButton} onClick={onAddFrame} title="Add screen">
            <Plus size={16} aria-hidden="true" />
          </button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
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
                  style={panelIconButton}
                  title="Delete screen"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      </NavigatorSection>
      <hr className="m-0 border-0 border-t border-line-soft" aria-hidden="true" />
      <NavigatorSection
        label="Layers"
        open={layersOpen}
        onToggle={() => setLayersOpen((open) => !open)}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
          {focusedRoot ? (
            <>
              <div style={{ background: color.chrome2, borderRadius: radius.base, padding: space.xs }}>
                <DocumentTree
                  node={focusedRoot}
                  rootId={focusedRoot.id}
                  selectedIds={selection}
                />
              </div>
              <div style={{ display: "flex", gap: space.xs }}>
                <button
                  type="button"
                  style={panelIconButton}
                  onClick={() => moveSelected(reverse ? 1 : -1)}
                  disabled={reverse ? !canMoveAfter : !canMoveBefore}
                  title={horizontal ? "Move left" : "Move up"}
                >
                  {horizontal ? (
                    <ArrowLeft size={16} aria-hidden="true" />
                  ) : (
                    <ArrowUp size={16} aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  style={panelIconButton}
                  onClick={() => moveSelected(reverse ? -1 : 1)}
                  disabled={reverse ? !canMoveBefore : !canMoveAfter}
                  title={horizontal ? "Move right" : "Move down"}
                >
                  {horizontal ? (
                    <ArrowRight size={16} aria-hidden="true" />
                  ) : (
                    <ArrowDown size={16} aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  style={panelIconButton}
                  onClick={deleteSelected}
                  disabled={!canDeleteLayer}
                  title="Delete layer"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            </>
          ) : (
            <p style={{ color: color.inkFaint, fontSize: text.sm, margin: 0 }}>
              Select a screen to inspect its layers.
            </p>
          )}
        </div>
      </NavigatorSection>
    </aside>
  );
}
