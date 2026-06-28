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
  Component,
  FolderOpen,
  Frame,
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
  type LucideIcon,
} from "lucide-react";
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
import { useStudioStore } from "./studio-store";
import { cn } from "./studio-ui";
import { DocumentTree } from "./DocumentTree";
import { deleteNodes, reorderNode } from "./document-actions";
import { TokensPanel } from "./TokensPanel";

type WorkspaceMode = "Screen" | "Component" | "Flow" | "Design System";
export type FlowId = string;
export type FlowPanelItem = { id: FlowId; label: string; gitCode?: string; screenCount?: number };
export type DesignSystemView = "Tokens" | "Typography" | "Colors" | "Spacing" | "Radius";
type GitFileStatus = { path: string; index: string; workingTree: string };
export type RepoPanelContext = {
  repoPath: string;
  repoName: string;
  packageManager: string;
  frameworks: Array<{ id: string; label: string; detail?: string }>;
  screens: Array<{
    path: string;
    name: string;
    kind: "source" | "sidecar";
    sidecarPath?: string;
    routeKind: "expo-router" | "react-navigation" | "unknown";
    rnCanvas: boolean;
  }>;
  sidecars: Array<{ path: string; screenName?: string; targetPath?: string }>;
  assets: Array<{ path: string; kind: string }>;
  entrypoints: string[];
  truncated?: boolean;
};
type RepoPanelScreen = RepoPanelContext["screens"][number];
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

function gitStatusTone(code: string): "neutral" | "accent" | "amber" {
  if (code === "U" || code === "A") return "accent";
  if (code === "D") return "amber";
  return code ? "neutral" : "neutral";
}

function GitBadge({ code, title }: { code?: string; title?: string }) {
  if (!code) return <span className="w-4 shrink-0" aria-hidden="true" />;
  const tone = gitStatusTone(code);
  return (
    <span
      title={title}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-xs border text-[9px] font-semibold leading-none",
        tone === "accent" && "border-accent-line bg-accent-soft text-accent",
        tone === "amber" && "border-amber/40 bg-amber/10 text-amber",
        tone === "neutral" && "border-line bg-chrome text-ink-faint",
      )}
    >
      {code}
    </span>
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

function firstGitCode(gitStatus: PanelGitStatus): string | undefined {
  if (gitStatus.status !== "ready") return undefined;
  return gitStatus.files.map(gitStatusCode).find(Boolean);
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
}: {
  tabs: string[];
  active: string;
  onSelect: (t: string) => void;
}) {
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
    { icon: ImageIcon, label: "Image", onClick: () => arm("Image"), active: armedTool === "Image", disabled: !canAddPrimitive },
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
                    item.type === armedTool ? "text-accent" : "text-ink-dim",
                  )}
                >
                  <Icon size={15} strokeWidth={1.75} aria-hidden="true" className="text-ink-faint" />
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
                    onClick={() => setArmedComponent(comp.id)}
                    className={cn(
                      "flex cursor-default items-center gap-sm rounded-sm px-sm py-menu-y text-sm outline-none data-[highlighted]:bg-raised data-[highlighted]:text-ink",
                      comp.id === armedComponentId ? "text-accent" : "text-ink-dim",
                    )}
                  >
                    <Component size={15} strokeWidth={1.75} aria-hidden="true" className="text-ink-faint" />
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
  onOpenRepoSettings = () => {},
  onOpenRepoScreen = () => {},
  gitStatus,
  targetPath,
  sidecarPath,
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
  onOpenRepoSettings: () => void;
  onOpenRepoScreen: (screen: RepoPanelScreen) => void;
  gitStatus: PanelGitStatus;
  targetPath: string;
  sidecarPath: string;
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

  const sidebarItem =
    "flex h-7 min-w-0 items-center gap-xs rounded-sm px-sm text-left text-sm transition-colors";
  const activeItem = "bg-accent-soft text-accent";
  const inactiveItem = "text-ink-dim hover:bg-raised hover:text-ink";
  const screenGitCode = gitCodeForPath(gitStatus, targetPath) ?? gitCodeForPath(gitStatus, sidecarPath);
  const sidecarGitCode = gitCodeForPath(gitStatus, sidecarPath);
  const themeGitCode = gitCodeForPath(gitStatus, "generated/theme.ts");
  const repoGitCode = firstGitCode(gitStatus);
  const repoName = repoContext?.repoName ?? "Repository";
  const repoFrameworks = repoContext?.frameworks ?? [];
  const repoScreens = repoContext?.screens ?? [];
  const repoAssets = repoContext?.assets ?? [];
  const repoEntrypoints = repoContext?.entrypoints ?? [];
  const frameworkLabels = repoFrameworks.map((framework) => framework.label);
  const repoSubtitle =
    frameworkLabels.length > 0
      ? `${frameworkLabels.slice(0, 3).join(" · ")}${frameworkLabels.length > 3 ? ` +${frameworkLabels.length - 3}` : ""}`
      : repoContext?.packageManager
        ? `No app runtime detected · ${repoContext.packageManager}`
        : "Attach a repo";
  const repoScreenCandidates =
    repoScreens.filter((screen) => screen.path !== targetPath && screen.sidecarPath !== sidecarPath);
  const visibleRepoScreens = repoScreenCandidates.slice(0, 6);
  const visibleAssets = repoAssets.slice(0, 4);
  const visibleEntrypoints = repoEntrypoints.slice(0, 3);
  const hasRuntimeSignals = !!repoContext && (
    repoFrameworks.length > 0 ||
    visibleEntrypoints.length > 0 ||
    repoContext.truncated
  );
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
          <Frame size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Changes"
          onClick={onOpenChanges}
          className="flex size-8 items-center justify-center rounded-sm text-ink-faint hover:bg-raised hover:text-ink"
        >
          <MoveVertical size={15} aria-hidden="true" />
        </button>
        <div className="flex-1" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-md overflow-y-auto p-md">
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-xs">
            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
              {repoName}
            </div>
            <GitBadge code={repoGitCode} title="Repository has changes" />
            <button
              type="button"
              style={panelIconButton}
              onClick={onOpenRepoSettings}
              title={repoContext ? "Change connected repo" : "Connect repo"}
            >
              <FolderOpen size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="truncate text-2xs text-accent" title={repoContext?.repoPath}>
            {repoSubtitle}
          </div>
          {repoContext && (
            <div className="mt-xs flex flex-wrap gap-xs text-2xs text-ink-faint">
              <span>{repoScreens.length} screens</span>
              <span>{repoContext.sidecars?.length ?? 0} sidecars</span>
              <span>{repoAssets.length} assets</span>
            </div>
          )}
        </div>

        {hasRuntimeSignals && (
          <section className="flex flex-col gap-xs">
            <Eyebrow>Runtime</Eyebrow>
            <div className="rounded-sm border border-line-soft bg-chrome-2 p-sm">
              <div className="flex flex-wrap gap-xs">
                {repoContext.packageManager !== "unknown" && (
                  <span className="rounded-pill bg-raised px-xs py-px text-2xs font-semibold text-ink-dim">
                    {repoContext.packageManager}
                  </span>
                )}
                {repoFrameworks.map((framework) => (
                  <span
                    key={framework.id}
                    title={framework.detail}
                    className="rounded-pill bg-accent-soft px-xs py-px text-2xs font-semibold text-accent"
                  >
                    {framework.label}
                  </span>
                ))}
                {repoContext.truncated && (
                  <span className="rounded-pill bg-raised px-xs py-px text-2xs font-semibold text-ink-faint">
                    scan capped
                  </span>
                )}
              </div>
              {visibleEntrypoints.length > 0 && (
                <div className="mt-xs flex flex-col gap-2xs">
                  {visibleEntrypoints.map((entry) => (
                    <div key={entry} className="truncate text-2xs text-ink-faint" title={entry}>
                      {entry}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-xs">
          <div className="flex items-center gap-xs">
            <Eyebrow>Flows</Eyebrow>
            <div className="flex-1" />
            <button type="button" style={panelIconButton} onClick={onAddFlow} title="Add flow">
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
          {flowItems.map((flow) => (
            <div key={flow.id} className="flex gap-xs">
              <button
                type="button"
                onClick={() => openFlow(flow.id)}
                className={cn(sidebarItem, "flex-1", workspace === "Flow" && activeFlow === flow.id ? activeItem : inactiveItem)}
              >
                <Route size={13} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{flow.label}</span>
                {flow.screenCount !== undefined && (
                  <span className="text-2xs tabular-nums text-ink-faint">{flow.screenCount}</span>
                )}
                <GitBadge code={flow.gitCode} title={sidecarPath} />
              </button>
              {pendingRemoveFlowId === flow.id ? (
                <>
                  <button
                    type="button"
                    style={panelIconButton}
                    onClick={() => onRemoveFlow(flow)}
                    title={`Confirm remove ${flow.label}`}
                    className="text-amber"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    style={panelIconButton}
                    onClick={onCancelRemoveFlow}
                    title="Cancel remove flow"
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  style={panelIconButton}
                  onClick={() => onRemoveFlow(flow)}
                  title={`Remove ${flow.label}`}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-xs">
          <div className="flex items-center gap-xs">
            <Eyebrow>Project Tree</Eyebrow>
            <div className="flex-1" />
            <button type="button" style={panelIconButton} onClick={onAddFrame} title="Add screen">
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
          {rootList
            .filter((root) => root.id !== editingComponentId)
            .map((root, index) => {
              const active = root.id === focusedRoot?.id && workspace === "Screen";
              const locked = !!root.design?.locked;
              return (
                <div key={root.id} className="flex flex-col gap-xs">
                  <div className="flex gap-xs">
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => {
                        setSelection([root.id]);
                        onWorkspaceChange("Screen");
                      }}
                      className={cn(sidebarItem, "flex-1", active ? activeItem : inactiveItem, locked && "cursor-not-allowed opacity-50")}
                    >
                      <Square size={13} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">
                        {root.design?.name ?? `Screen ${index + 1}`}
                      </span>
                      <GitBadge code={screenGitCode} title={`${screenGitCode ?? ""} ${targetPath}`} />
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
                  {root.id === focusedRoot?.id && (
                    <div className="ml-md flex flex-col gap-xs border-l border-line-soft pl-xs">
                      <div className="rounded-sm border border-line/40 bg-chrome-2 p-xs">
                        <DocumentTree
                          node={root}
                          rootId={root.id}
                          selectedIds={selection}
                          gitBadge={<GitBadge code={sidecarGitCode} title={`${sidecarGitCode ?? ""} ${sidecarPath}`} />}
                        />
                      </div>
                      <div className="flex gap-xs">
                        <button
                          type="button"
                          style={panelIconButton}
                          onClick={() => moveSelected(reverse ? 1 : -1)}
                          disabled={reverse ? !canMoveAfter : !canMoveBefore}
                          title={horizontal ? "Move left" : "Move up"}
                        >
                          {horizontal ? <ArrowLeft size={16} aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
                        </button>
                        <button
                          type="button"
                          style={panelIconButton}
                          onClick={() => moveSelected(reverse ? -1 : 1)}
                          disabled={reverse ? !canMoveBefore : !canMoveAfter}
                          title={horizontal ? "Move right" : "Move down"}
                        >
                          {horizontal ? <ArrowRight size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />}
                        </button>
                        <button
                          type="button"
                          style={panelIconButton}
                          onClick={createComponent}
                          disabled={!canMakeComponent}
                          title="Create component"
                        >
                          <Component size={15} aria-hidden="true" />
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
                    </div>
                  )}
                </div>
              );
            })}
          {visibleRepoScreens.length > 0 && (
            <div className="mt-xs flex flex-col gap-xs border-t border-line-soft pt-sm">
              <Eyebrow>Repo Screens</Eyebrow>
              {visibleRepoScreens.map((screen) => {
                const gitCode =
                  gitCodeForPath(gitStatus, screen.path) ??
                  (screen.sidecarPath ? gitCodeForPath(gitStatus, screen.sidecarPath) : undefined);
                return (
                  <button
                    type="button"
                    key={screen.path}
                    onClick={() => onOpenRepoScreen(screen)}
                    className={cn(sidebarItem, "text-ink-dim hover:bg-raised hover:text-ink")}
                    title={screen.rnCanvas ? `Open ${screen.sidecarPath ?? screen.path}` : `Import ${screen.path}`}
                  >
                    <Square size={13} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{screen.name}</span>
                    {screen.rnCanvas && (
                      <span className="rounded-pill bg-accent-soft px-xs py-px text-2xs font-semibold text-accent">
                        canvas
                      </span>
                    )}
                    <GitBadge code={gitCode} title={screen.path} />
                  </button>
                );
              })}
              {repoScreenCandidates.length > visibleRepoScreens.length && (
                <div className="px-sm text-2xs text-ink-faint">
                  +{repoScreenCandidates.length - visibleRepoScreens.length} more screens
                </div>
              )}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-xs">
          <div className="flex items-center gap-xs">
            <Eyebrow>Components</Eyebrow>
          </div>
          {componentList.length === 0 ? (
            <p className="m-0 text-sm text-ink-faint">Select a layer and “Create component” to add one.</p>
          ) : (
            componentList.map((comp) => {
              const armed = armedComponentId === comp.id;
              const componentGitCode = gitCodeForPath(gitStatus, `generated/components/${comp.name}.tsx`);
              return (
                <div key={comp.id} className="flex gap-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setArmedComponent(armed ? null : comp.id);
                      onWorkspaceChange("Component");
                    }}
                    title={armed ? "Click a screen to place, or click to disarm" : "Arm to place an instance"}
                    className={cn(sidebarItem, "flex-1", workspace === "Component" || armed ? activeItem : inactiveItem)}
                  >
                    <Component size={13} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{comp.name}</span>
                    <GitBadge code={componentGitCode} title={`generated/components/${comp.name}.tsx`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      beginComponentEdit(comp.id);
                      onWorkspaceChange("Component");
                    }}
                    style={panelIconButton}
                    title="Edit component"
                  >
                    <Pencil size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeComponent(comp.id)}
                    style={panelIconButton}
                    title="Delete component"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              );
            })
          )}
        </section>

        <section className="flex flex-col gap-xs">
          <Eyebrow>Design System</Eyebrow>
          {designSystemViews.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => openDesignSystem(item)}
              className={cn(sidebarItem, workspace === "Design System" && activeDesignSystemView === item ? activeItem : inactiveItem)}
            >
              <Type size={13} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{item}</span>
              <GitBadge code={item === "Tokens" ? themeGitCode : undefined} title="generated/theme.ts" />
            </button>
          ))}
        </section>

        <section className="flex flex-col gap-xs">
          <Eyebrow>Changes</Eyebrow>
          <button type="button" onClick={onOpenChanges} className={cn(sidebarItem, inactiveItem)}>
            <MoveVertical size={13} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">Activity and PR readiness</span>
            <GitBadge code={repoGitCode} title="Repository has changes" />
          </button>
        </section>

        {visibleAssets.length > 0 && (
          <section className="flex flex-col gap-xs">
            <Eyebrow>Assets</Eyebrow>
            {visibleAssets.map((asset) => (
              <div key={asset.path} className={cn(sidebarItem, "text-ink-dim")} title={asset.path}>
                <ImageIcon size={13} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{shortPathLabel(asset.path)}</span>
                <span className="text-2xs text-ink-faint">{asset.kind}</span>
              </div>
            ))}
          </section>
        )}

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
