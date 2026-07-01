/**
 * Studio shell — the region skeleton from STUDIO-UI.md. Structure + token styling
 * only; each region's functional UI fills in as its phase lands. Chrome only:
 * everything here is theme-token-styled and never touches RN artboard content.
 */
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Component,
  FileText,
  Frame,
  Hand,
  Image as ImageIcon,
  List,
  MousePointer2,
  MousePointerClick,
  MoveVertical,
  Pencil,
  Plus,
  Route,
  Square,
  TextCursorInput,
  Trash2,
  Type,
  X,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import {
  childrenOf,
  findNode,
  findRootContaining,
  getParent,
  RN_PRIMITIVES,
  useDocumentStore,
  type NodeId,
  type RNPrimitive,
} from "@rn-canvas/document";
import { Menu } from "@base-ui/react/menu";
import { color, layout, radius, space, text } from "./studio-theme";
import { type CanvasTool, useStudioStore } from "./studio-store";
import { cn, PanelAction, PanelRow, PanelSection, PanelStaticRow, Tooltip } from "./studio-ui";
import { DocumentTree } from "./DocumentTree";
import { deleteNodes, reorderNode } from "./document-actions";
import { TokensPanel } from "./TokensPanel";
import {
  displayScreenName,
  repoFlowItemsForContext,
  type RepoPanelContext,
  type RepoPanelScreen,
} from "./repo-project-model";

type WorkspaceMode = "Screen" | "Component" | "Flow" | "Design System";
export type FlowId = string;
export type FlowPanelItem = { id: FlowId; label: string; gitCode?: string; screenCount?: number };
export type DesignSystemView = "Tokens" | "Typography" | "Colors" | "Spacing" | "Radius";
type GitFileStatus = { path: string; index: string; workingTree: string };
type PanelGitStatus =
  | { status: "loading" }
  | { status: "ready"; files: GitFileStatus[]; clean: boolean }
  | { status: "error"; message: string };

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

/** A PascalCase identifier for a component name (falls back to "Component"). */
function pascalCase(input: string): string {
  const pascal = input
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  if (!pascal) return "Component";
  return /^[A-Z]/.test(pascal) ? pascal : `C${pascal}`;
}

function gitStatusCode(file: GitFileStatus): string {
  const code = `${file.index}${file.workingTree}`;
  if (code === "??") return "U";
  if (file.workingTree === "M" || file.index === "M") return "M";
  if (file.workingTree === "D" || file.index === "D") return "D";
  if (file.workingTree === "A" || file.index === "A") return "A";
  if (file.workingTree === "R" || file.index === "R") return "R";
  return code.trim() || "";
}

function gitStatusTone(code: string): "neutral" | "accent" | "amber" | "live" {
  if (code === "A" || code === "U") return "live";
  if (code === "D") return "amber";
  return code ? "accent" : "neutral";
}

function GitBadge({ code, title }: { code?: string; title?: string }) {
  if (!code) return <span className="w-1 shrink-0" aria-hidden="true" />;
  const tone = gitStatusTone(code);
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "flex size-1 shrink-0 items-center justify-center rounded-full",
        tone === "accent" && "bg-accent",
        tone === "live" && "bg-live",
        tone === "amber" && "bg-amber",
        tone === "neutral" && "bg-ink-faint",
      )}
    />
  );
}

function gitFileForPath(gitStatus: PanelGitStatus, path: string): GitFileStatus | undefined {
  if (gitStatus.status !== "ready") return undefined;
  return gitStatus.files.find((file) => file.path === path || file.path.endsWith(`/${path}`));
}

function gitCodeForPath(gitStatus: PanelGitStatus, path: string): string | undefined {
  const file = gitFileForPath(gitStatus, path);
  return file ? gitStatusCode(file) : undefined;
}

function gitCodeForScreen(gitStatus: PanelGitStatus, screen: RepoPanelScreen): string | undefined {
  return gitCodeForPath(gitStatus, screen.path) ??
    (screen.sidecarPath ? gitCodeForPath(gitStatus, screen.sidecarPath) : undefined);
}

function firstGitCodeForScreens(gitStatus: PanelGitStatus, screens: RepoPanelScreen[]): string | undefined {
  return screens.map((screen) => gitCodeForScreen(gitStatus, screen)).find(Boolean);
}

function firstGitCode(gitStatus: PanelGitStatus): string | undefined {
  if (gitStatus.status !== "ready") return undefined;
  return gitStatus.files.map(gitStatusCode).find(Boolean);
}

function layerCount(node: { children?: Array<{ children?: unknown[] }> }): number {
  return node.children?.reduce((total, child) => total + 1 + layerCount(child), 0) ?? 0;
}

function shortPathLabel(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

/** A quiet segmented tab bar used by the left panel and inspector. */
export function Tabs({
  tabs,
  active,
  onSelect,
  variant = "segmented",
}: {
  tabs: string[];
  active: string;
  onSelect: (t: string) => void;
  variant?: "segmented" | "underline";
}) {
  if (variant === "underline") {
    return (
      <div className="flex h-8 items-end gap-md border-b border-line-soft">
        {tabs.map((t) => {
          const on = t === active;
          return (
            <button
              key={t}
              type="button"
              onClick={() => onSelect(t)}
              className={cn(
                "relative h-8 px-2xs text-xs font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line",
                on ? "text-accent" : "text-ink-faint hover:text-ink",
              )}
            >
              {t}
              {on && (
                <span
                  className="absolute inset-x-0 bottom-[-1px] h-px bg-accent"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex gap-xs rounded-sm border border-line/60 bg-chrome-2 p-2xs">
      {tabs.map((t) => {
        const on = t === active;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onSelect(t)}
            className={cn(
              "h-6 flex-1 rounded-xs px-sm text-xs font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line",
              on ? "bg-raised text-ink shadow-control" : "text-ink-dim hover:text-ink",
            )}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

type RailTool = { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; kbd?: string };
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
const railButtonActive =
  "border-accent bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--accent-line)] " +
  "hover:border-accent hover:bg-accent-soft";

/**
 * tldraw owns frame placement; every creation tool *arms* a primitive, which the
 * next canvas drag draws as a node. The rail carries the core tools (Select,
 * Frame, View, Text, Image); the remaining semantic primitives sit in the Insert
 * menu so the rail stays uncluttered.
 */
export function ToolRail({
  onCanvasTool,
  onAddFrame,
  canAddPrimitive,
}: {
  onCanvasTool: (tool: CanvasTool) => void;
  onAddFrame: () => void;
  canAddPrimitive: boolean;
}) {
  const canvasTool = useStudioStore((s) => s.canvasTool);
  const armedTool = useStudioStore((s) => s.armedTool);
  const armedComponentId = useStudioStore((s) => s.armedComponentId);
  const setArmedTool = useStudioStore((s) => s.setArmedTool);
  const arm = (type: RNPrimitive) => setArmedTool(armedTool === type ? null : type);
  const idle = armedTool === null && armedComponentId === null;

  const tools: (RailTool & { active?: boolean })[] = [
    {
      icon: MousePointer2,
      label: "Select",
      kbd: "V",
      onClick: () => onCanvasTool("select"),
      active: idle && canvasTool === "select",
    },
    {
      icon: Hand,
      label: "Hand",
      kbd: "H",
      onClick: () => onCanvasTool("hand"),
      active: idle && canvasTool === "hand",
    },
    {
      icon: ZoomIn,
      label: "Zoom",
      kbd: "Z",
      onClick: () => onCanvasTool("zoom"),
      active: idle && canvasTool === "zoom",
    },
    {
      icon: Frame,
      label: "Frame",
      kbd: "F",
      onClick: () => {
        setArmedTool(null);
        onAddFrame();
      },
    },
    {
      icon: Square,
      label: "View",
      kbd: "R",
      onClick: () => arm("View"),
      active: armedTool === "View",
      disabled: !canAddPrimitive,
    },
    {
      icon: Type,
      label: "Text",
      kbd: "T",
      onClick: () => arm("Text"),
      active: armedTool === "Text",
      disabled: !canAddPrimitive,
    },
    {
      icon: ImageIcon,
      label: "Image",
      kbd: "I",
      onClick: () => arm("Image"),
      active: armedTool === "Image",
      disabled: !canAddPrimitive,
    },
  ];
  return (
    <nav
      aria-label="Tools"
      className={cn(
        "studio-chrome pointer-events-auto absolute bottom-md left-1/2 z-20 flex -translate-x-1/2",
        "items-center gap-xs rounded-md border border-line bg-chrome/95 px-xs py-xs",
        "shadow-popover backdrop-blur",
      )}
    >
      {tools.map((t) => {
        const Icon = t.icon;
        return (
          <Tooltip key={t.label} label={t.label} kbd={t.kbd} side="top">
            <button
              type="button"
              aria-label={t.label}
              aria-pressed={t.active}
              onClick={t.onClick}
              disabled={t.disabled}
              className={cn(railButton, t.active && railButtonActive)}
            >
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </Tooltip>
        );
      })}
      <div className="mx-xs h-5 w-px bg-line" aria-hidden="true" />
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
  const components = useDocumentStore((s) => s.components);
  const armedComponentId = useStudioStore((s) => s.armedComponentId);
  const setArmedComponent = useStudioStore((s) => s.setArmedComponent);
  const componentList = Object.values(components);
  const armedInMenu =
    INSERT_ITEMS.some((i) => i.type === armedTool) || armedComponentId !== null;
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
        <Menu.Positioner side="top" align="end" sideOffset={8} className="z-50">
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
                    item.type === armedTool
                      ? "bg-accent-soft text-accent"
                      : "text-ink-dim",
                  )}
                >
                  <Icon size={14} strokeWidth={1.75} aria-hidden="true" className="text-ink-faint" />
                  {item.label}
                </Menu.Item>
              );
            })}
            {componentList.length > 0 && (
              <>
                <div className="eyebrow px-sm py-xs">Components</div>
                {componentList.map((comp) => (
                  <Menu.Item
                    key={comp.id}
                    onClick={() =>
                      setArmedComponent(comp.id === armedComponentId ? null : comp.id)
                    }
                    className={cn(
                      "flex cursor-default items-center gap-sm rounded-sm px-sm py-menu-y text-sm outline-none data-[highlighted]:bg-raised data-[highlighted]:text-ink",
                      comp.id === armedComponentId
                        ? "bg-accent-soft text-accent"
                        : "text-ink-dim",
                    )}
                  >
                    <Component size={14} strokeWidth={1.75} aria-hidden="true" className="text-ink-faint" />
                    {comp.name}
                  </Menu.Item>
                ))}
              </>
            )}
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

/** Project navigation: real document objects organized in designer language. */
export function LeftPanel({
  workspace,
  onWorkspaceChange,
  onAddFrame,
  activeFlow,
  onFlowChange,
  flows = [],
  onAddFlow = () => {},
  onRemoveFlow = () => {},
  onCancelRemoveFlow = () => {},
  pendingRemoveFlowId,
  activeDesignSystemView,
  onDesignSystemViewChange,
  onOpenChanges,
  onOpenRepoScreen = () => {},
  onFocusCanvasScreen = () => {},
  gitStatus,
  sidecarPath,
  activeRepoScreen,
  loadedRepoScreens = {},
  repoContext,
}: {
  workspace: WorkspaceMode;
  onWorkspaceChange: (workspace: WorkspaceMode) => void;
  onAddFrame: () => void;
  activeFlow: FlowId;
  onFlowChange: (flow: FlowId) => void;
  flows: FlowPanelItem[];
  onAddFlow: () => void;
  onRemoveFlow: (flow: FlowPanelItem) => void;
  onCancelRemoveFlow: () => void;
  pendingRemoveFlowId?: FlowId | null;
  activeDesignSystemView: DesignSystemView;
  onDesignSystemViewChange: (view: DesignSystemView) => void;
  onOpenChanges: () => void;
  onOpenRepoScreen: (screen: RepoPanelScreen) => void;
  onFocusCanvasScreen: () => void;
  gitStatus: PanelGitStatus;
  sidecarPath: string;
  activeRepoScreen?: { path: string; sidecarPath?: string; rootId: NodeId } | null;
  loadedRepoScreens?: Record<string, { path: string; sidecarPath?: string; rootId: NodeId }>;
  repoContext?: RepoPanelContext | null;
}) {
  const roots = useDocumentStore((state) => state.roots);
  const selection = useDocumentStore((state) => state.selection);
  const setSelection = useDocumentStore((state) => state.setSelection);
  const removeRoot = useDocumentStore((state) => state.removeRoot);
  const components = useDocumentStore((state) => state.components);
  const promoteToComponent = useDocumentStore((state) => state.promoteToComponent);
  const removeComponent = useDocumentStore((state) => state.removeComponent);
  const editingComponentId = useDocumentStore((state) => state.editingComponentId);
  const beginComponentEdit = useDocumentStore((state) => state.beginComponentEdit);
  const tokens = useDocumentStore((state) => state.tokens);
  const addToken = useDocumentStore((state) => state.addToken);
  const armedComponentId = useStudioStore((state) => state.armedComponentId);
  const setArmedComponent = useStudioStore((state) => state.setArmedComponent);
  const [collapsedLayerRoots, setCollapsedLayerRoots] = useState<Record<NodeId, boolean>>({});
  const [collapsedRepoFlows, setCollapsedRepoFlows] = useState<Record<string, boolean>>({});
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
  // A component can be made from exactly one non-root, non-instance, unlocked node.
  const canMakeComponent =
    selection.length === 1 &&
    canDeleteLayer &&
    selectedNode?.type !== "ComponentInstance";
  const componentList = Object.values(components);

  function createComponent() {
    if (!focusedRoot || !selectedId || !selectedNode) return;
    const pascal = pascalCase(selectedNode.design?.name ?? selectedNode.type);
    // Avoid auto-naming a component exactly like an RN primitive (e.g. "Text",
    // "View"), which would shadow the imported primitive in generated screens.
    const base = (RN_PRIMITIVES as readonly string[]).includes(pascal)
      ? `${pascal}Component`
      : pascal;
    const taken = new Set(componentList.map((comp) => comp.name));
    let name = base;
    for (let i = 2; taken.has(name); i += 1) name = `${base}${i}`;
    promoteToComponent(focusedRoot.id, selectedId, name);
  }

  const tokenList = Object.values(tokens);
  function createToken(category: "color" | "spacing" | "fontSize") {
    const base = category === "color" ? "color" : category === "spacing" ? "space" : "text";
    const taken = new Set(tokenList.filter((t) => t.category === category).map((t) => t.name));
    let name = `${base}1`;
    for (let i = 2; taken.has(name); i += 1) name = `${base}${i}`;
    const value = category === "color" ? "#3b82f6" : category === "spacing" ? 8 : 16;
    addToken({ id: crypto.randomUUID(), name, category, value });
  }

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

  function layerAccordion(root: typeof rootList[number]) {
    const collapsed = collapsedLayerRoots[root.id] ?? false;
    const count = layerCount(root);
    return (
      <div className="ml-md flex flex-col gap-xs border-l border-line-soft pl-xs">
        <button
          type="button"
          onClick={() => {
            setCollapsedLayerRoots((current) => ({
              ...current,
              [root.id]: !collapsed,
            }));
          }}
          aria-expanded={!collapsed}
          className="group flex h-7 min-w-0 items-center gap-xs rounded-sm px-xs text-left text-2xs font-semibold uppercase tracking-[0.12em] text-ink-faint transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line"
        >
          {collapsed ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate">Layers</span>
          <span className="tabular-nums">{count}</span>
        </button>
        {!collapsed && (
          <>
            <div className="rounded-sm border border-line/40 bg-chrome-2 p-xs">
              <DocumentTree node={root} rootId={root.id} selectedIds={selection} />
            </div>
            <div className="flex gap-xs">
              <PanelAction
                onClick={() => moveSelected(reverse ? 1 : -1)}
                disabled={reverse ? !canMoveAfter : !canMoveBefore}
                title={horizontal ? "Move left" : "Move up"}
              >
                {horizontal ? <ArrowLeft size={16} aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
              </PanelAction>
              <PanelAction
                onClick={() => moveSelected(reverse ? -1 : 1)}
                disabled={reverse ? !canMoveBefore : !canMoveAfter}
                title={horizontal ? "Move right" : "Move down"}
              >
                {horizontal ? <ArrowRight size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />}
              </PanelAction>
              <PanelAction
                onClick={createComponent}
                disabled={!canMakeComponent}
                title="Create component"
              >
                <Component size={14} aria-hidden="true" />
              </PanelAction>
              <PanelAction
                onClick={deleteSelected}
                disabled={!canDeleteLayer}
                title="Delete layer"
              >
                <Trash2 size={14} aria-hidden="true" />
              </PanelAction>
            </div>
          </>
        )}
      </div>
    );
  }

  const activeItem = "bg-accent-soft text-accent";
  const rowAction = "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100";
  const sidecarGitCode = gitCodeForPath(gitStatus, sidecarPath);
  const themeGitCode = gitCodeForPath(gitStatus, "generated/theme.ts");
  const repoGitCode = firstGitCode(gitStatus);
  const repoScreens = repoContext?.screens ?? [];
  const repoAssets = repoContext?.assets ?? [];
  function loadedRootIdForRepoScreen(screen: RepoPanelScreen) {
    return loadedRepoScreens[screen.path]?.rootId;
  }

  function isActiveRepoScreen(screen: RepoPanelScreen) {
    const loadedRootId = loadedRootIdForRepoScreen(screen);
    return (
      workspace === "Screen" &&
      !!activeRepoScreen &&
      (screen.path === activeRepoScreen.path ||
        (!!screen.sidecarPath && screen.sidecarPath === activeRepoScreen.sidecarPath) ||
        (!!loadedRootId && loadedRootId === activeRepoScreen.rootId))
    );
  }

  const activeRepoScreenItem = repoScreens.find(isActiveRepoScreen);
  const repoFlowGroups = repoFlowItemsForContext(repoContext);
  const visibleAssets = repoAssets.slice(0, 4);
  const activeRepoRootById = activeRepoScreen
    ? rootList.find((root) => root.id === activeRepoScreen.rootId)
    : undefined;
  const loadedRepoRootIds = new Set(
    repoScreens.flatMap((screen) => {
      const loaded = loadedRepoScreens[screen.path];
      return loaded ? [loaded.rootId] : [];
    }),
  );
  const canvasScreens = rootList.filter((root) => root.id !== editingComponentId);
  const canvasScreenEntries = canvasScreens
    .filter((root) => !loadedRepoRootIds.has(root.id))
    .map((root, index) => ({
      kind: "canvas" as const,
      id: `canvas:${root.id}`,
      root,
      label: root.design?.name ?? `Screen ${index + 1}`,
      active: root.id === focusedRoot?.id && workspace === "Screen",
      gitCode: undefined as string | undefined,
      gitTitle: undefined as string | undefined,
    }));
  const repoScreenEntries = repoScreens.map((screen) => {
    const gitCode = gitCodeForScreen(gitStatus, screen);
    return {
      kind: "repo" as const,
      id: `repo:${screen.path}`,
      screen,
      label: displayScreenName(screen),
      active: isActiveRepoScreen(screen),
      gitCode,
      gitTitle: screen.path,
    };
  });
  const screenLabelCounts = new Map<string, number>();
  for (const item of [...canvasScreenEntries, ...repoScreenEntries]) {
    screenLabelCounts.set(item.label, (screenLabelCounts.get(item.label) ?? 0) + 1);
  }
  const screenItems = [
    ...canvasScreenEntries.map((item) => ({ ...item, detail: undefined as string | undefined })),
    ...repoScreenEntries.map((item) => ({
      ...item,
      detail: screenLabelCounts.get(item.label)! > 1 ? item.screen.path : undefined,
    })),
  ];
  const changedFiles = gitStatus.status === "ready" ? gitStatus.files : [];
  const flowItems = flows.map((flow, index) => ({
    ...flow,
    gitCode: flow.gitCode ?? (index === 0 ? sidecarGitCode : undefined),
  }));
  const designSystemViews: DesignSystemView[] = ["Tokens", "Typography", "Colors", "Spacing", "Radius"];

  function openFlow(flow: FlowId) {
    onFlowChange(flow);
    onWorkspaceChange("Flow");
  }

  function openDesignSystem(view: DesignSystemView) {
    onDesignSystemViewChange(view);
    onWorkspaceChange("Design System");
  }

  return (
    <aside
      className="studio-chrome flex border-r border-line bg-chrome"
      style={{
        flex: `0 0 ${layout.leftPanel}px`,
        width: layout.leftPanel,
      }}
    >
      <div className="flex w-14 shrink-0 flex-col items-center gap-sm border-r border-line-soft py-md">
        <div className="flex size-8 items-center justify-center rounded-sm bg-accent text-chrome text-sm font-semibold">
          RN
        </div>
        <button
          type="button"
          title="Project"
          onClick={() => onWorkspaceChange("Screen")}
          className={cn("flex size-8 items-center justify-center rounded-sm", activeItem)}
        >
          <Frame size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Changes"
          onClick={onOpenChanges}
          className="flex size-8 items-center justify-center rounded-sm text-ink-faint hover:bg-raised hover:text-ink"
        >
          <MoveVertical size={14} aria-hidden="true" />
        </button>
        <div className="flex-1" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-md [&>*]:border-b [&>*]:border-line-soft [&>*]:py-md [&>*:last-child]:border-b-0">
        <PanelSection
          title="Flows"
          count={flowItems.length + repoFlowGroups.length}
          action={(
            <PanelAction onClick={onAddFlow} title="Add flow">
              <Plus size={16} aria-hidden="true" />
            </PanelAction>
          )}
        >
          {flowItems.map((flow) => (
            <PanelRow
              key={flow.id}
              icon={Route}
                onClick={() => openFlow(flow.id)}
              active={workspace === "Flow" && activeFlow === flow.id}
              action={pendingRemoveFlowId === flow.id ? (
                <>
                  <PanelAction
                    onClick={() => onRemoveFlow(flow)}
                    title={`Confirm remove ${flow.label}`}
                    className="text-amber opacity-100"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </PanelAction>
                  <PanelAction
                    onClick={onCancelRemoveFlow}
                    title="Cancel remove flow"
                    className="opacity-100"
                  >
                    <X size={14} aria-hidden="true" />
                  </PanelAction>
                </>
              ) : (
                <PanelAction
                  onClick={() => onRemoveFlow(flow)}
                  title={`Remove ${flow.label}`}
                  className={rowAction}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </PanelAction>
              )}
            >
                <span className="min-w-0 flex-1 truncate">{flow.label}</span>
                {flow.screenCount !== undefined && (
                  <span className="text-2xs tabular-nums text-ink-faint">{flow.screenCount}</span>
                )}
                <GitBadge code={flow.gitCode} title={sidecarPath} />
            </PanelRow>
          ))}
          {repoFlowGroups.map((flow) => {
            const collapsed = collapsedRepoFlows[flow.id] ?? false;
            const hasActiveScreen = flow.screens.some(isActiveRepoScreen);
            return (
              <div key={flow.id} className="flex flex-col gap-xs">
                <PanelRow
                  icon={Route}
                  onClick={() => openFlow(flow.id)}
                  active={hasActiveScreen}
                  title={`Show ${flow.name} flow`}
                  action={(
                    <PanelAction
                      onClick={() => {
                        setCollapsedRepoFlows((current) => ({
                          ...current,
                          [flow.id]: !collapsed,
                        }));
                      }}
                      aria-expanded={!collapsed}
                      title={collapsed ? `Expand ${flow.name}` : `Collapse ${flow.name}`}
                    >
                      {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                    </PanelAction>
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{flow.name}</span>
                  <span className="text-2xs tabular-nums text-ink-faint">{flow.screens.length}</span>
                  <GitBadge code={firstGitCodeForScreens(gitStatus, flow.screens)} title={`${flow.name} has changes`} />
                </PanelRow>
                {!collapsed && (
                  <div className="ml-md flex flex-col gap-xs border-l border-line-soft pl-xs">
                    {flow.screens.map((screen) => {
                      const gitCode = gitCodeForScreen(gitStatus, screen);
                      return (
                        <div key={`${flow.id}:${screen.path}`} className="flex flex-col gap-xs">
                          <PanelRow
                            icon={FileText}
                            onClick={() => onOpenRepoScreen(screen)}
                            active={isActiveRepoScreen(screen)}
                            title={`Open ${screen.path}`}
                            className="text-xs"
                          >
                            <span className="min-w-0 flex-1 truncate">{displayScreenName(screen)}</span>
                            <GitBadge code={gitCode} title={screen.path} />
                          </PanelRow>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </PanelSection>

        <PanelSection
          title="Screens"
          count={screenItems.length}
          action={(
            <PanelAction onClick={onAddFrame} title="Add screen">
              <Plus size={16} aria-hidden="true" />
            </PanelAction>
          )}
        >
          {screenItems.map((item) => {
            const locked = item.kind === "canvas" && !!item.root.design?.locked;
            const repoLayerRoot = item.kind === "repo"
              ? rootList.find((root) => root.id === loadedRootIdForRepoScreen(item.screen)) ?? activeRepoRootById
              : undefined;
            return (
              <div key={item.id} className="flex flex-col gap-xs">
                <PanelRow
                  icon={FileText}
                  disabled={locked}
                  onClick={() => {
                    if (item.kind === "canvas") {
                      onFocusCanvasScreen();
                      setSelection([item.root.id]);
                      onWorkspaceChange("Screen");
                    } else {
                      onOpenRepoScreen(item.screen);
                    }
                  }}
                  active={item.active}
                  title={item.kind === "repo" ? `Open ${item.screen.path}` : undefined}
                  className={locked ? "cursor-not-allowed opacity-50" : undefined}
                  action={
                    item.kind === "canvas" ? (
                      <PanelAction
                        disabled={locked}
                        onClick={() => deleteScreen(item.root.id)}
                        title="Delete screen"
                        className={rowAction}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </PanelAction>
                    ) : undefined
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.detail && (
                    <span className="min-w-0 max-w-28 truncate text-2xs text-ink-faint">
                      {item.detail}
                    </span>
                  )}
                  <GitBadge code={item.gitCode} title={item.gitTitle} />
                </PanelRow>
                {item.kind === "canvas" && item.root.id === focusedRoot?.id && layerAccordion(item.root)}
                {item.kind === "repo" && item.active && repoLayerRoot && layerAccordion(repoLayerRoot)}
              </div>
            );
          })}
        </PanelSection>

        <PanelSection title="Components" count={componentList.length}>
          {componentList.length === 0 ? (
            <p className="m-0 px-sm text-xs text-ink-faint">No components yet.</p>
          ) : (
            componentList.map((comp) => {
              const armed = armedComponentId === comp.id;
              const componentGitCode = gitCodeForPath(gitStatus, `generated/components/${comp.name}.tsx`);
              return (
                <PanelRow
                  key={comp.id}
                  icon={Component}
                  onClick={() => {
                    setArmedComponent(armed ? null : comp.id);
                    onWorkspaceChange("Component");
                  }}
                  title={armed ? "Click a screen to place, or click to disarm" : "Arm to place an instance"}
                  active={workspace === "Component" || armed}
                  action={(
                    <>
                      <PanelAction
                        onClick={() => {
                          beginComponentEdit(comp.id);
                          onWorkspaceChange("Component");
                        }}
                        title="Edit component"
                        className={rowAction}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </PanelAction>
                      <PanelAction
                        onClick={() => removeComponent(comp.id)}
                        title="Delete component"
                        className={rowAction}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </PanelAction>
                    </>
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{comp.name}</span>
                  <GitBadge code={componentGitCode} title={`generated/components/${comp.name}.tsx`} />
                </PanelRow>
              );
            })
          )}
        </PanelSection>

        <PanelSection title="Design System" count={designSystemViews.length}>
          {designSystemViews.map((item) => (
            <PanelRow
              key={item}
              icon={Type}
              onClick={() => openDesignSystem(item)}
              active={workspace === "Design System" && activeDesignSystemView === item}
            >
              <span className="min-w-0 flex-1 truncate">{item}</span>
              <GitBadge code={item === "Tokens" ? themeGitCode : undefined} title="generated/theme.ts" />
            </PanelRow>
          ))}
        </PanelSection>

        {visibleAssets.length > 0 && (
          <PanelSection title="Assets" count={repoAssets.length}>
            {visibleAssets.map((asset) => (
              <PanelStaticRow key={asset.path} icon={ImageIcon} title={asset.path}>
                <span className="min-w-0 flex-1 truncate">{shortPathLabel(asset.path)}</span>
                <span className="text-2xs text-ink-faint">{asset.kind}</span>
              </PanelStaticRow>
            ))}
          </PanelSection>
        )}

        <PanelSection title="Changes" count={changedFiles.length}>
          <PanelRow icon={MoveVertical} onClick={onOpenChanges}>
            <span className="min-w-0 flex-1 truncate">Activity and PR readiness</span>
            <GitBadge code={repoGitCode} title="Repository has changes" />
          </PanelRow>
        </PanelSection>

        {workspace === "Design System" && (
          <section className="flex flex-col gap-sm border-t border-line-soft pt-md">
            <div className="flex items-center gap-xs">
              <Eyebrow>Token Quick Edit</Eyebrow>
              <div className="flex-1" />
              <Menu.Root>
                <Menu.Trigger style={panelIconButton} title="Add token">
                  <Plus size={16} aria-hidden="true" />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
                    <Menu.Popup className="studio-popup min-w-36 rounded-md border border-line bg-chrome p-control shadow-popover outline-none">
                      <Menu.Item onClick={() => createToken("color")} className="cursor-default rounded-sm px-sm py-menu-y text-sm text-ink-dim outline-none data-[highlighted]:bg-raised data-[highlighted]:text-ink">Color</Menu.Item>
                      <Menu.Item onClick={() => createToken("spacing")} className="cursor-default rounded-sm px-sm py-menu-y text-sm text-ink-dim outline-none data-[highlighted]:bg-raised data-[highlighted]:text-ink">Spacing</Menu.Item>
                      <Menu.Item onClick={() => createToken("fontSize")} className="cursor-default rounded-sm px-sm py-menu-y text-sm text-ink-dim outline-none data-[highlighted]:bg-raised data-[highlighted]:text-ink">Font size</Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            </div>
            <TokensPanel onCreate={createToken} />
          </section>
        )}
      </div>
    </aside>
  );
}
