import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileCode2,
  FileJson2,
  FolderOpen,
  Play,
  RefreshCw,
  Redo2,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  Tldraw,
  createShapeId,
  type Editor,
  type TLComponents,
  type TLUiOverrides,
} from "tldraw";
import "tldraw/tldraw.css";
import {
  createNode,
  findNode,
  findRootContaining,
  getParent,
  useDocumentStore,
  type ComponentRegistry,
  type DesignToken,
  type Node,
  type NodeId,
  type RNPrimitive,
  type TokenCategory,
} from "@rn-canvas/document";
import { FrameRenderer } from "@rn-canvas/render-web";
import { FrameShapeUtil, type FrameShape } from "./shapes/FrameShape";
import { Inspector } from "./Inspector";
import { ErrorBoundary } from "./ErrorBoundary";
import { color, layout, radius, space, text } from "./studio-theme";
import {
  Eyebrow,
  LeftPanel,
  Tabs,
  ToolRail,
  type DesignSystemView,
  type FlowId,
  type FlowPanelItem,
} from "./shell";
import {
  displayScreenName,
  repoChangesForContext,
  repoFlowItemsForContext,
  type RepoFlowPanelItem,
  type RepoPanelContext,
  type RepoPanelScreen,
} from "./repo-project-model";
import {
  Button,
  ColorPickerPopover,
  Field,
  IconButton,
  Section,
  StatusPill,
  TextField,
  cn,
} from "./studio-ui";
import { deleteNodes, duplicateNodes, reorderNode } from "./document-actions";
import { startMcpBridge } from "./mcp-bridge";
import { handleMcpCommand } from "./mcp-command-handler";
import { normalizeNodeSelection } from "./selection";
import { useStudioStore } from "./studio-store";

const shapeUtils = [FrameShapeUtil];
const FRAME_TYPE = FrameShapeUtil.type;

// Lockdown: tldraw is a frame host, not a whiteboard. Hide its default chrome so
// users can't reach tldraw-native shapes/styles (which aren't RN nodes and can't
// be exported). The watermark is intentionally left in place (license requires it).
const components: TLComponents = {
  Toolbar: null,
  MainMenu: null,
  StylePanel: null,
  PageMenu: null,
  ActionsMenu: null,
  QuickActions: null,
  HelpMenu: null,
  ZoomMenu: null,
  NavigationPanel: null,
  KeyboardShortcutsDialog: null,
  DebugMenu: null,
  DebugPanel: null,
};

// tldraw's shape vocabulary is Frame only. Keep navigation tools (select, hand,
// zoom); remove every shape-creating/destructive tool so no tldraw-native shape can
// be made. RN primitives are document layers created via the tool rail (draw-to-create).
const KEEP_TOOLS = new Set(["select", "hand", "zoom"]);
const overrides: TLUiOverrides = {
  tools(_editor, tools) {
    for (const id of Object.keys(tools)) {
      if (!KEEP_TOOLS.has(id)) delete tools[id];
    }
    return tools;
  },
};

// tldraw's editor methods type shapes as the closed builtin union, so reads/
// writes of our custom shape go through these narrow casts.
type EditorShape = ReturnType<Editor["getCurrentPageShapes"]>[number];
const isFrame = (s: EditorShape) => (s.type as string) === FRAME_TYPE;
const asFrame = (s: EditorShape) => s as unknown as FrameShape;
type CreatePartial = Parameters<Editor["createShape"]>[0];
type UpdatePartial = Parameters<Editor["updateShape"]>[0];

type CodegenResult = {
  screenName: string;
  code: string;
  sidecar: string;
  targetPath: string;
  sidecarPath: string;
  components?: { name: string; fileName: string; code: string }[];
  componentPaths?: string[];
  theme?: { fileName: string; code: string };
  themePath?: string;
  wrote?: boolean;
};

type CodeArtifact = {
  id: string;
  label: string;
  path: string;
  kind: "tsx" | "json" | "theme";
  code: string;
};

type SyncState =
  | { status: "idle" }
  | { status: "scheduled" }
  | { status: "syncing" }
  | { status: "synced"; path: string }
  | { status: "error"; message: string };

type GitFileStatus = {
  path: string;
  index: string;
  workingTree: string;
};

type GitStatus =
  | { status: "loading" }
  | { status: "ready"; repoPath: string; branch: string; clean: boolean; files: GitFileStatus[] }
  | { status: "error"; message: string };

type RepoContext = RepoPanelContext;

type WorkspaceMode = "Screen" | "Component" | "Flow" | "Design System";
type FlowDefinition = { id: FlowId; label: string; description?: string };

type FlowManifest = {
  version: 1;
  flows: Array<{
    id: FlowId;
    label: string;
    entryRootId?: NodeId;
    entryName?: string;
    routes: Array<{ rootId: NodeId; name: string }>;
  }>;
};

type OpenDocumentResult = {
  version: 1;
  screenName: string;
  root: Node;
  components?: import("@rn-canvas/document").ComponentRegistry;
  tokens?: import("@rn-canvas/document").TokenRegistry;
  repoPath?: string;
  targetPath: string;
  sidecarPath: string;
};

type ImportSourceResult = {
  screenName: string;
  root: Node;
  repoPath?: string;
  sourcePath: string;
  sidecarPath: string;
};

function rootSize(root: Node): { w: number; h: number } {
  const w = typeof root.style.width === "number" ? root.style.width : 320;
  const h = typeof root.style.height === "number" ? root.style.height : 200;
  return { w, h };
}

/** Logical size of the default device canvas (iPhone 14/13, points). */
const DEVICE_FRAME = { width: 390, height: 844 } as const;
const DEVICE_SAFE_AREA = { top: 64, bottom: 48, side: 16 } as const;

/**
 * A blank full-bleed mobile screen: device-sized, top-aligned column, white,
 * no card border/radius. The starting point for authoring a real screen.
 */
function createScreenFrame(children: Node[] = []): Node {
  return createNode("View", {
    style: {
      width: DEVICE_FRAME.width,
      height: DEVICE_FRAME.height,
      backgroundColor: "#ffffff",
      flexDirection: "column",
      padding: DEVICE_SAFE_AREA.side,
      paddingTop: DEVICE_SAFE_AREA.top,
      paddingBottom: DEVICE_SAFE_AREA.bottom,
      gap: 12,
    },
    children,
  });
}

function codeArtifacts(result: CodegenResult | null): CodeArtifact[] {
  if (!result) return [];
  const artifacts: CodeArtifact[] = [
    {
      id: "screen",
      label: result.targetPath.split("/").pop() ?? result.targetPath,
      path: result.targetPath,
      kind: "tsx",
      code: result.code,
    },
    {
      id: "document",
      label: result.sidecarPath.split("/").pop() ?? result.sidecarPath,
      path: result.sidecarPath,
      kind: "json",
      code: result.sidecar,
    },
  ];
  if (result.theme) {
    artifacts.push({
      id: "theme",
      label: result.theme.fileName,
      path: result.themePath ?? result.theme.fileName,
      kind: "theme",
      code: result.theme.code,
    });
  }
  result.components?.forEach((component, index) => {
    artifacts.push({
      id: `component-${index}-${component.name}`,
      label: component.fileName,
      path: result.componentPaths?.[index] ?? `components/${component.fileName}`,
      kind: "tsx",
      code: component.code,
    });
  });
  return artifacts;
}

function gitFileStatusLabel(file: GitFileStatus): string {
  const code = `${file.index}${file.workingTree}`;
  if (code === "??") return "Untracked";
  if (file.workingTree === "M" || file.index === "M") return "Modified";
  if (file.workingTree === "D" || file.index === "D") return "Deleted";
  if (file.workingTree === "A" || file.index === "A") return "Added";
  if (file.workingTree === "R" || file.index === "R") return "Renamed";
  return code.trim() || "Changed";
}

function gitSummary(status: GitStatus): string {
  if (status.status === "loading") return "Git loading";
  if (status.status === "error") return "Git unavailable";
  if (status.clean) return `${status.branch} clean`;
  return `${status.branch} ${status.files.length} changed`;
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

function firstGitCode(status: GitStatus): string | undefined {
  if (status.status !== "ready") return undefined;
  return status.files.map(gitStatusCode).find(Boolean);
}

/** Create a tldraw shape for any document root that doesn't have one yet. */
function createMissingShapes(editor: Editor, roots: Record<NodeId, Node>) {
  const existing = new Set(
    editor
      .getCurrentPageShapes()
      .filter(isFrame)
      .map((s) => asFrame(s).props.rootId),
  );
  let i = existing.size;
  for (const root of Object.values(roots)) {
    if (existing.has(root.id)) continue;
    const { w, h } = rootSize(root);
    editor.createShape({
      id: createShapeId(),
      type: FRAME_TYPE,
      x: 80 + (i % 3) * (DEVICE_FRAME.width + 50),
      y: 80 + Math.floor(i / 3) * (DEVICE_FRAME.height + 56),
      props: { rootId: root.id, w, h },
      isLocked: !!root.design?.locked,
    } as unknown as CreatePartial);
    i += 1;
  }
}

/** Frame records derive from document roots, so reconciliation must never
 *  become an independent tldraw undo entry. */
function syncShapes(editor: Editor) {
  editor.run(
    () => createMissingShapes(editor, useDocumentStore.getState().roots),
    { history: "ignore", ignoreShapeLock: true },
  );
}

function canvasGeometrySignature(editor: Editor) {
  return editor
    .getCurrentPageShapes()
    .filter(isFrame)
    .map((shape) => {
      const frame = asFrame(shape);
      return [frame.id, frame.x, frame.y, frame.rotation, frame.props.w, frame.props.h];
    })
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map((parts) => parts.join(":"))
    .join("|");
}

function stepCanvasHistory(editor: Editor, direction: "undo" | "redo") {
  const before = canvasGeometrySignature(editor);
  for (let skipped = 0; skipped < 100; skipped += 1) {
    const available = direction === "undo" ? editor.getCanUndo() : editor.getCanRedo();
    if (!available) return;
    editor[direction]();
    if (canvasGeometrySignature(editor) !== before) return;
  }
}

function findFrameShapeForRoot(editor: Editor, rootId: NodeId): EditorShape | undefined {
  return editor
    .getCurrentPageShapes()
    .find((shape) => isFrame(shape) && asFrame(shape).props.rootId === rootId);
}

function focusRootFrame(editor: Editor, rootId: NodeId, animate = true) {
  const shape = findFrameShapeForRoot(editor, rootId);
  if (!shape) return false;
  editor.select(shape.id);
  const bounds = editor.getShapePageBounds(shape);
  if (bounds) {
    editor.zoomToBounds(bounds, {
      inset: 96,
      animation: animate ? { duration: 180 } : undefined,
    });
  }
  return true;
}

function syncCanvasFrameSelection(editor: Editor, rootId: NodeId, selectFrame: boolean) {
  const shape = findFrameShapeForRoot(editor, rootId);
  if (!shape) return false;
  const selected = editor.getSelectedShapeIds().includes(shape.id);
  if (selectFrame) {
    if (!selected) editor.select(shape.id);
    return true;
  }
  if (selected) editor.deselect(shape.id);
  return true;
}

const DEFAULT_FLOWS: FlowDefinition[] = [
  {
    id: "onboarding",
    label: "Onboarding Flow",
    description: "Default stack order for first-run screens.",
  },
  {
    id: "main",
    label: "Main App Flow",
    description: "Primary app route order from the current screen tree.",
  },
  {
    id: "auth",
    label: "Auth Flow",
    description: "Authentication screens inferred from screen names when present.",
  },
];

const TOKEN_IDENTIFIER = /^[A-Za-z_$][\w$]*(\.[\w$]+)*$/;

function slugFlowId(label: string, taken: Set<string>) {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "flow";
  let id = base;
  for (let i = 2; taken.has(id); i += 1) id = `${base}-${i}`;
  return id;
}

function flowLabel(flows: FlowDefinition[], id: FlowId) {
  return flows.find((flow) => flow.id === id)?.label ?? "Flow";
}

function flowDescription(flows: FlowDefinition[], id: FlowId) {
  return (
    flows.find((flow) => flow.id === id)?.description ??
    "Prototype route order for this screen group."
  );
}

function flowScreens(roots: Node[], flow: FlowId): Node[] {
  if (flow === "onboarding") return roots;
  const lowered = (root: Node) => (root.design?.name ?? "").toLowerCase();
  const auth = roots.filter((root) =>
    /auth|login|sign|create|verify|welcome/.test(lowered(root)),
  );
  const main = roots.filter((root) => !auth.includes(root));
  if (flow === "auth") return auth.length ? auth : roots.slice(0, 1);
  return main.length ? main : roots;
}

function orderedFlowScreens(screens: Node[], entryRootId?: NodeId): Node[] {
  if (!entryRootId) return screens;
  const entry = screens.find((root) => root.id === entryRootId);
  if (!entry) return screens;
  return [entry, ...screens.filter((root) => root.id !== entryRootId)];
}

function FlowScreenPreview({
  root,
  components,
}: {
  root: Node;
  components: ComponentRegistry;
}) {
  const { w, h } = rootSize(root);
  const scale = Math.min(144 / w, 256 / h);
  const previewWidth = w * scale;
  const previewHeight = h * scale;

  return (
    <div className="relative h-64 w-36 overflow-hidden rounded-sm bg-white shadow-inner">
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 origin-top-left"
        style={{
          width: w,
          height: h,
          transform: `translate(-${previewWidth / 2}px, -${previewHeight / 2}px) scale(${scale})`,
        }}
      >
        <FrameRenderer root={root} components={components} />
      </div>
    </div>
  );
}

function FlowWorkspace({
  roots,
  components,
  flows,
  repoFlows,
  activeFlow,
  entryRootId,
  onSelectScreen,
  onOpenRepoScreen,
  onEntryRootChange,
  onAddFrame,
}: {
  roots: Node[];
  components: ComponentRegistry;
  flows: FlowDefinition[];
  repoFlows: RepoFlowPanelItem[];
  activeFlow: FlowId;
  entryRootId?: NodeId;
  onSelectScreen: (rootId: NodeId) => void;
  onOpenRepoScreen: (screen: RepoPanelScreen) => void;
  onEntryRootChange: (rootId: NodeId) => void;
  onAddFrame: () => void;
}) {
  const screens = roots.filter(
    (root) =>
      !useDocumentStore.getState().editingComponentId ||
      root.id !== useDocumentStore.getState().editingComponentId,
  );
  const routeScreens = orderedFlowScreens(flowScreens(screens, activeFlow), entryRootId);
  const entryScreen = routeScreens[0];
  const screenLabels = new Map(
    screens.map((root, index) => [root.id, root.design?.name ?? `Screen ${index + 1}`]),
  );
  const labelFor = (root: Node, fallbackIndex: number) =>
    screenLabels.get(root.id) ?? root.design?.name ?? `Screen ${fallbackIndex + 1}`;
  const entryLabel = entryScreen ? labelFor(entryScreen, 0) : null;
  const flowViewportRef = useRef<HTMLDivElement | null>(null);
  const repoFlow = repoFlows.find((flow) => flow.id === activeFlow);

  useEffect(() => {
    if (flowViewportRef.current) flowViewportRef.current.scrollLeft = 0;
  }, [activeFlow, entryRootId]);

  if (repoFlow) {
    const entry = repoFlow.screens[0];
    return (
      <div className="studio-chrome flex h-full flex-col bg-canvas">
        <div className="flex items-center gap-sm border-b border-line bg-chrome px-lg py-sm">
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-ink">{repoFlow.name}</span>
            <span className="text-xs text-ink-faint">
              Repo-inferred journey from route order
            </span>
          </div>
          {entry && (
            <div className="ml-lg rounded-pill bg-raised px-sm py-1 text-xs text-ink-dim">
              Entry <span className="font-medium text-ink">{displayScreenName(entry)}</span>
            </div>
          )}
        </div>
        <div ref={flowViewportRef} className="relative flex-1 overflow-auto">
          <div className="grid min-h-full min-w-[760px] grid-cols-[minmax(0,1fr)_280px]">
            <div className="overflow-auto p-2xl">
              <div className="flex min-w-max items-start gap-2xl">
                {repoFlow.screens.map((screen, index) => (
                  <div key={screen.path} className="relative flex w-44 flex-col items-center gap-sm">
                    {index > 0 && (
                      <div
                        className="absolute -left-2xl top-20 h-px w-2xl bg-accent-line"
                        aria-hidden="true"
                      />
                    )}
                    <div className="flex h-5 items-center gap-xs text-xs font-medium text-ink-dim">
                      <span>{displayScreenName(screen)}</span>
                      {index === 0 && (
                        <span className="rounded-pill bg-accent-soft px-xs py-px text-2xs font-semibold text-accent">
                          Entry
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenRepoScreen(screen)}
                      className="flex h-40 w-36 flex-col items-center justify-center gap-sm rounded-sm border border-line bg-chrome p-md text-center shadow-control transition-colors hover:border-accent-line hover:bg-raised"
                      title={screen.path}
                    >
                      <span className="flex size-9 items-center justify-center rounded-sm bg-accent-soft text-sm font-semibold text-accent">
                        {index + 1}
                      </span>
                      <span className="max-w-full truncate text-sm font-semibold text-ink">
                        {displayScreenName(screen)}
                      </span>
                      <span className="max-w-full truncate text-2xs text-ink-faint">
                        {screen.path}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <aside className="border-l border-line bg-chrome p-md">
              <div className="flex flex-col gap-md">
                <div>
                  <div className="eyebrow">Route Wiring</div>
                  <div className="mt-xs text-sm font-semibold text-ink">
                    {repoFlow.screens.length} screens
                  </div>
                  <p className="m-0 mt-xs text-xs text-ink-faint">
                    This sequence is inferred from matching route folders. Open a screen to edit its layers.
                  </p>
                </div>
                <div className="flex flex-col gap-xs">
                  {repoFlow.screens.map((screen, index) => (
                    <button
                      key={screen.path}
                      type="button"
                      onClick={() => onOpenRepoScreen(screen)}
                      className="flex min-h-8 items-center gap-xs rounded-sm px-sm py-xs text-left text-sm text-ink-dim transition-colors hover:bg-raised hover:text-ink"
                    >
                      <span className="w-5 shrink-0 text-2xs tabular-nums text-ink-faint">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{displayScreenName(screen)}</span>
                        <span className="block truncate text-2xs text-ink-faint">{screen.path}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-chrome flex h-full flex-col bg-canvas">
      <div className="flex items-center gap-sm border-b border-line bg-chrome px-lg py-sm">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-ink">{flowLabel(flows, activeFlow)}</span>
          <span className="text-xs text-ink-faint">{flowDescription(flows, activeFlow)}</span>
        </div>
        {entryScreen && (
          <div className="ml-lg rounded-pill bg-raised px-sm py-1 text-xs text-ink-dim">
            Entry <span className="font-medium text-ink">{entryLabel}</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-xs">
          <IconButton title="Add screen" onClick={onAddFrame}>
            <PlusIcon />
          </IconButton>
        </div>
      </div>
      <div ref={flowViewportRef} className="relative flex-1 overflow-auto">
        <div className="grid min-h-full min-w-[760px] grid-cols-[minmax(0,1fr)_260px]">
          <div className="overflow-auto p-2xl">
            <div className="flex min-w-max items-start gap-2xl">
              {routeScreens.map((root, index) => (
                <div key={root.id} className="relative flex flex-col items-center gap-sm">
                  {index > 0 && (
                    <div
                      className="absolute -left-2xl top-28 h-px w-2xl bg-accent-line"
                      aria-hidden="true"
                    />
                  )}
                  <div className="flex h-5 items-center gap-xs text-xs font-medium text-ink-dim">
                    <span>{labelFor(root, index)}</span>
                    {root.id === entryScreen?.id && (
                      <span className="rounded-pill bg-accent-soft px-xs py-px text-2xs font-semibold text-accent">
                        Entry
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectScreen(root.id)}
                    className="flex h-64 w-36 items-center justify-center overflow-hidden rounded-sm border border-line bg-chrome shadow-control transition-colors hover:border-accent-line hover:bg-raised"
                  >
                    <FlowScreenPreview root={root} components={components} />
                  </button>
                </div>
              ))}
              {routeScreens.length === 0 && (
                <div className="rounded-sm border border-line bg-chrome p-xl text-sm text-ink-faint">
                  Add a screen to start mapping the flow.
                </div>
              )}
            </div>
          </div>
          <aside className="border-l border-line bg-chrome p-md">
            <div className="flex flex-col gap-md">
              <div>
                <div className="eyebrow">Navigator</div>
                <div className="mt-xs text-sm font-semibold text-ink">
                  Prototype route graph
                </div>
                <p className="m-0 mt-xs text-xs text-ink-faint">
                  Route order follows the selected entrypoint. Router adapters can map this
                  graph to React Navigation, Expo Router, or a custom stack later.
                </p>
              </div>
              {entryScreen && (
                <div className="rounded-sm bg-raised p-sm">
                  <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">
                    Entry point
                  </div>
                  <div className="mt-xs truncate text-sm font-medium text-ink">
                    {entryLabel}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-xs">
                {routeScreens.map((root, index) => (
                  <div
                    key={root.id}
                    className="flex h-8 items-center gap-xs rounded-sm px-sm text-sm text-ink-dim transition-colors hover:bg-raised hover:text-ink"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectScreen(root.id)}
                      className="flex min-w-0 flex-1 items-center gap-xs text-left"
                    >
                      <span className="w-5 shrink-0 text-2xs tabular-nums text-ink-faint">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {labelFor(root, index)}
                      </span>
                    </button>
                    {root.id === entryScreen?.id ? (
                      <span className="shrink-0 text-2xs font-semibold text-accent">
                        Entry
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onEntryRootChange(root.id)}
                        className="shrink-0 rounded-pill px-xs py-px text-2xs text-ink-faint transition-colors hover:bg-chrome hover:text-ink"
                      >
                        Set entry
                      </button>
                    )}
                  </div>
                ))}
                {routeScreens.length === 0 && (
                  <p className="m-0 text-xs text-ink-faint">No screens in this flow yet.</p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function DesignSystemWorkspace({
  tokens,
  activeView,
  onViewChange,
  onCreateToken,
}: {
  tokens: DesignToken[];
  activeView: DesignSystemView;
  onViewChange: (view: DesignSystemView) => void;
  onCreateToken: (category: "color" | "spacing" | "fontSize") => void;
}) {
  const grouped = {
    color: tokens.filter((token) => token.category === "color"),
    spacing: tokens.filter((token) => token.category === "spacing"),
    fontSize: tokens.filter((token) => token.category === "fontSize"),
  };
  return (
    <div className="studio-chrome flex h-full flex-col bg-canvas">
      <div className="flex items-center gap-md border-b border-line bg-chrome px-lg py-sm">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-ink">Tokens</span>
          <span className="text-xs text-ink-faint">Define reusable color, spacing, and type values.</span>
        </div>
        <div className="ml-auto flex items-center gap-xs">
          {(["Tokens", "Colors", "Typography", "Spacing", "Radius"] as DesignSystemView[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onViewChange(tab)}
              className={cn(
                "h-7 rounded-sm px-sm text-xs transition-colors",
                activeView === tab
                  ? "bg-accent-soft text-accent"
                  : "text-ink-dim hover:bg-raised hover:text-ink",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-xl">
        <div className="mx-auto flex max-w-4xl flex-col gap-lg">
          {(activeView === "Tokens" || activeView === "Colors") && (
            <TokenBoard
              title="Colors"
              category="color"
              tokens={grouped.color}
              onCreate={() => onCreateToken("color")}
            />
          )}
          {(activeView === "Tokens" || activeView === "Spacing") && (
            <TokenBoard
              title="Spacing Scale"
              category="spacing"
              tokens={grouped.spacing}
              onCreate={() => onCreateToken("spacing")}
            />
          )}
          {(activeView === "Tokens" || activeView === "Typography") && (
            <TokenBoard
              title="Type Scale"
              category="fontSize"
              tokens={grouped.fontSize}
              onCreate={() => onCreateToken("fontSize")}
            />
          )}
          {activeView === "Radius" && (
            <section className="rounded-sm border border-line bg-chrome p-lg text-sm text-ink-faint shadow-control">
              Radius tokens are not part of the current document token model yet.
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function TokenBoard({
  title,
  category,
  tokens,
  onCreate,
}: {
  title: string;
  category: TokenCategory;
  tokens: DesignToken[];
  onCreate: () => void;
}) {
  return (
    <section className="rounded-sm border border-line bg-chrome p-md shadow-control">
      <div className="mb-md flex items-center">
        <div>
          <span className="text-sm font-semibold text-ink">{title}</span>
          <div className="mt-2xs text-xs text-ink-faint">{tokens.length} tokens</div>
        </div>
        <div className="ml-auto" />
        <Button className="ml-sm" variant="ghost" onClick={onCreate}>
          <PlusIcon /> Add
        </Button>
      </div>
      <div className={cn(
        "grid gap-sm",
        category === "color"
          ? "grid-cols-[repeat(auto-fill,minmax(150px,1fr))]"
          : "grid-cols-[repeat(auto-fill,minmax(220px,1fr))]",
      )}>
        {tokens.length === 0 ? (
          <div className="rounded-sm border border-dashed border-line bg-chrome-2 p-lg text-sm text-ink-faint">
            No tokens yet.
          </div>
        ) : tokens.map((token) => <TokenBoardCard key={token.id} token={token} />)}
      </div>
    </section>
  );
}

function TokenBoardCard({ token }: { token: DesignToken }) {
  const tokens = useDocumentStore((s) => s.tokens);
  const updateToken = useDocumentStore((s) => s.updateToken);
  const removeToken = useDocumentStore((s) => s.removeToken);
  const getTokenUsage = useDocumentStore((s) => s.getTokenUsage);
  const setSelection = useDocumentStore((s) => s.setSelection);
  const [nameDraft, setNameDraft] = useState(token.name);
  const usage = useMemo(() => getTokenUsage(token.id), [getTokenUsage, token.id, tokens]);

  useEffect(() => setNameDraft(token.name), [token.name]);

  const commitName = () => {
    const next = nameDraft.trim().replace(/-/g, ".");
    const duplicate = Object.values(tokens).some(
      (item) => item.id !== token.id && item.category === token.category && item.name === next,
    );
    if (!next || !TOKEN_IDENTIFIER.test(next) || duplicate) {
      setNameDraft(token.name);
      return;
    }
    if (next !== token.name) updateToken(token.id, { name: next });
  };

  const deleteToken = () => {
    if (
      usage.length > 0 &&
      !window.confirm(`Delete ${token.name}? It is used by ${usage.length} node${usage.length === 1 ? "" : "s"}.`)
    ) {
      return;
    }
    removeToken(token.id);
  };

  const selectUsage = () => {
    if (usage.length === 0) return;
    setSelection(Array.from(new Set(usage.map((item) => item.nodeId))));
  };

  return (
    <div className="group flex min-h-36 flex-col gap-sm rounded-sm border border-line-soft bg-chrome-2 p-sm transition-colors hover:border-line hover:bg-raised/50">
      <TokenSpecimen token={token} onValueChange={(value) => updateToken(token.id, { value })} />
      <div className="mt-auto flex items-center gap-xs">
        <input
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            if (event.key === "Escape") {
              setNameDraft(token.name);
              (event.target as HTMLInputElement).blur();
            }
          }}
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded-xs border border-transparent bg-transparent px-xs font-mono text-xs text-ink outline-none transition-colors hover:bg-chrome focus-visible:border-accent-line focus-visible:bg-chrome"
        />
        <button
          type="button"
          onClick={selectUsage}
          disabled={usage.length === 0}
          title={usage.length ? `Used ${usage.length} time${usage.length === 1 ? "" : "s"}` : "Unused"}
          className="h-6 min-w-7 rounded-xs bg-chrome px-xs text-2xs tabular-nums text-ink-faint disabled:opacity-40 enabled:hover:bg-accent-soft enabled:hover:text-accent"
        >
          {usage.length}
        </button>
        <IconButton title="Delete token" onClick={deleteToken}>
          <Trash2 size={13} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}

function TokenSpecimen({
  token,
  onValueChange,
}: {
  token: DesignToken;
  onValueChange: (value: DesignToken["value"]) => void;
}) {
  const editLifecycle = useMemo(
    () => ({
      onEditStart: () => {
        const store = useDocumentStore.getState();
        if (!store.interaction) store.beginInteraction();
      },
      onEditEnd: () => useDocumentStore.getState().commitInteraction(),
      onEditCancel: () => useDocumentStore.getState().cancelInteraction(),
    }),
    [],
  );

  if (token.category === "color") {
    const value = String(token.value);
    return (
      <div className="flex flex-col gap-sm">
        <div className="relative block h-24 overflow-hidden rounded-sm border border-line bg-chrome">
          <span className="color-checker absolute inset-0 opacity-40" aria-hidden="true" />
          <span className="absolute inset-0" style={{ background: value }} aria-hidden="true" />
          <ColorPickerPopover
            value={value}
            onChange={onValueChange}
            onEditStart={editLifecycle.onEditStart}
            onEditEnd={editLifecycle.onEditEnd}
            onEditCancel={editLifecycle.onEditCancel}
            trigger={
              <button
                type="button"
                className="absolute inset-0 cursor-pointer"
                aria-label={`${token.name} color`}
              />
            }
          />
        </div>
        <input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          className="h-7 rounded-xs border border-line bg-chrome px-xs font-mono text-xs text-ink outline-none focus-visible:border-accent-line"
          spellCheck={false}
        />
      </div>
    );
  }

  if (token.category === "spacing") {
    const value = Number(token.value) || 0;
    return (
      <div className="flex flex-col gap-sm">
        <div className="flex h-24 items-end gap-xs rounded-sm border border-line bg-chrome p-sm">
          {[0.5, 0.75, 1, 1.5, 2].map((multiplier) => (
            <span
              key={multiplier}
              className="block flex-1 rounded-t-xs bg-accent/45"
              style={{ height: `${Math.max(8, Math.min(84, value * multiplier))}px` }}
              aria-hidden="true"
            />
          ))}
        </div>
        <NumberTokenInput value={value} suffix="px" onChange={onValueChange} />
      </div>
    );
  }

  const value = Number(token.value) || 0;
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex h-24 items-center overflow-hidden rounded-sm border border-line bg-chrome px-sm">
        <span
          className="truncate font-semibold text-ink"
          style={{ fontSize: Math.max(10, Math.min(42, value)) }}
        >
          Ag
        </span>
      </div>
      <NumberTokenInput value={value} suffix="pt" onChange={onValueChange} />
    </div>
  );
}

function NumberTokenInput({
  value,
  suffix,
  onChange,
}: {
  value: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex h-7 items-center gap-xs rounded-xs border border-line bg-chrome px-xs text-xs text-ink-faint">
      <input
        type="number"
        value={value}
        min={0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-w-0 flex-1 bg-transparent text-right tabular-nums text-ink outline-none"
      />
      <span>{suffix}</span>
    </label>
  );
}

function PlusIcon() {
  return <span className="text-base leading-none">+</span>;
}

function ChangesTimeline({
  gitStatus,
  repoPath,
  repoContext,
  onRefresh,
  onOpenCode,
}: {
  gitStatus: GitStatus;
  repoPath: string;
  repoContext: RepoContext | null;
  onRefresh: () => void;
  onOpenCode: () => void;
}) {
  const entries: Array<{
    id: string;
    label: string;
    detail: string;
    tone?: "accent" | "amber";
    files?: GitFileStatus[];
  }> = [];

  if (gitStatus.status === "loading") {
    entries.push({ id: "git-loading", label: "Git status", detail: "Loading repository status." });
  } else if (gitStatus.status === "error") {
    entries.push({ id: "git-error", label: "Git unavailable", detail: gitStatus.message, tone: "amber" });
  } else if (gitStatus.clean) {
    entries.push({ id: "git-clean", label: "Git clean", detail: gitStatus.branch });
  } else {
    const groups = repoChangesForContext(repoContext, gitStatus.files);
    groups.slice(0, 12).forEach((group) => {
      const deleted = group.files.some((file) => file.index === "D" || file.workingTree === "D");
      entries.push({
        id: group.id,
        label: group.label,
        detail: `${group.detail} · ${group.files.length} ${group.files.length === 1 ? "file" : "files"}`,
        tone: deleted ? "amber" : "accent",
        files: group.files,
      });
    });
    if (groups.length > 12) {
      entries.push({
        id: "more",
        label: "More changes",
        detail: `${groups.length - 12} additional objects`,
      });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-md p-md text-sm">
      <div className="flex items-center gap-xs">
        <Eyebrow>Git Changes</Eyebrow>
        <div className="flex-1" />
        <IconButton title="Refresh Git status" onClick={onRefresh}>
          <RefreshCw size={14} aria-hidden="true" />
        </IconButton>
      </div>
      {repoPath && (
        <div className="truncate rounded-sm border border-line bg-chrome-2 px-sm py-xs text-xs text-ink-faint" title={repoPath}>
          {repoPath}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-xs overflow-y-auto pr-xs">
        {entries.map((entry) => (
          <div key={entry.id} className="flex gap-sm rounded-sm border border-line bg-chrome-2 p-sm">
            <span
              className={cn(
                "mt-1 size-2 shrink-0 rounded-pill bg-ink-faint",
                entry.tone === "accent" && "bg-accent",
                entry.tone === "amber" && "bg-amber",
              )}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink">{entry.label}</div>
              <div className="truncate text-xs text-ink-faint" title={entry.detail}>
                {entry.detail}
              </div>
              {entry.files && entry.files.length > 0 && (
                <div className="mt-xs flex flex-col gap-2xs">
                  {entry.files.slice(0, 4).map((file) => (
                    <div
                      key={`${file.index}${file.workingTree}-${file.path}`}
                      className="flex min-w-0 items-center gap-xs text-2xs text-ink-faint"
                      title={file.path}
                    >
                      <span className="shrink-0 rounded-xs bg-raised px-2xs font-mono">
                        {gitFileStatusLabel(file)}
                      </span>
                      <span className="min-w-0 truncate">{file.path}</span>
                    </div>
                  ))}
                  {entry.files.length > 4 && (
                    <div className="text-2xs text-ink-faint">
                      +{entry.files.length - 4} more files
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="rounded-sm border border-line bg-chrome-2 p-md text-sm text-ink-faint">
            No changes yet.
          </div>
        )}
      </div>
      <Button onClick={onOpenCode}>
        <FileCode2 size={14} aria-hidden="true" /> View generated files
      </Button>
    </div>
  );
}

export default function App() {
  const editorRef = useRef<Editor | null>(null);
  const reconcilingShapesRef = useRef(false);
  const codegenBusyRef = useRef(false);
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipCodeSyncRef = useRef(false);
  const skipNextPathSyncRef = useRef(false);
  const syncRootIdRef = useRef<NodeId | null>(null);
  const pendingFocusRootIdRef = useRef<NodeId | null>(null);

  const [status, setStatus] = useState("Drag a frame · resize from handles · add from the toolbar");
  const [inspectorTab, setInspectorTab] = useState("Inspect");
  const [workspace, setWorkspace] = useState<WorkspaceMode>("Screen");
  const [flows, setFlows] = useState<FlowDefinition[]>(DEFAULT_FLOWS);
  const [activeFlow, setActiveFlow] = useState<FlowId>("onboarding");
  const [flowEntrypoints, setFlowEntrypoints] = useState<Partial<Record<FlowId, NodeId>>>({});
  const [pendingRemoveFlowId, setPendingRemoveFlowId] = useState<FlowId | null>(null);
  const [activeDesignSystemView, setActiveDesignSystemView] =
    useState<DesignSystemView>("Tokens");
  const [screenName, setScreenName] = useState("Screen");
  const [targetPath, setTargetPath] = useState("generated/Screen.tsx");
  const [sidecarPath, setSidecarPath] = useState("generated/Screen.rncanvas.json");
  const [codegenResult, setCodegenResult] = useState<CodegenResult | null>(null);
  const [activeArtifactId, setActiveArtifactId] = useState("screen");
  const [codegenError, setCodegenError] = useState<string | null>(null);
  const [codegenBusy, setCodegenBusy] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>({ status: "idle" });
  const [gitStatus, setGitStatus] = useState<GitStatus>({ status: "loading" });
  const [repoPath, setRepoPath] = useState("");
  const [repoDraft, setRepoDraft] = useState("");
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoBusy, setRepoBusy] = useState(false);
  const [repoContext, setRepoContext] = useState<RepoContext | null>(null);
  const [canvasCanUndo, setCanvasCanUndo] = useState(false);
  const [canvasCanRedo, setCanvasCanRedo] = useState(false);

  // The document store's selection is the single source of truth. The focused
  // frame is *derived* from it (the root whose subtree holds the selection), and
  // canvas selection is kept in sync with it below — neither side owns its own copy.
  const roots = useDocumentStore((s) => s.roots);
  const selection = useDocumentStore((s) => s.selection);
  const editingComponentId = useDocumentStore((s) => s.editingComponentId);
  const componentRegistry = useDocumentStore((s) => s.components);
  const tokens = useDocumentStore((s) => s.tokens);
  const editingComponentName = editingComponentId
    ? componentRegistry[editingComponentId]?.name ?? "Component"
    : null;
  const focusedRoot = useMemo(
    () => findRootContaining(Object.values(roots), selection[0] ?? ""),
    [roots, selection],
  );
  const focusedRootId = focusedRoot?.id ?? null;
  const artifacts = useMemo(() => codeArtifacts(codegenResult), [codegenResult]);
  const flowPanelItems = useMemo<FlowPanelItem[]>(() => {
    const screenRoots = Object.values(roots).filter((root) => root.id !== editingComponentId);
    return flows.map((flow) => ({
      id: flow.id,
      label: flow.label,
      screenCount: flowScreens(screenRoots, flow.id).length,
    }));
  }, [editingComponentId, flows, roots]);
  const repoFlowItems = useMemo(
    () => repoFlowItemsForContext(repoContext),
    [repoContext],
  );
  const activeArtifact =
    artifacts.find((artifact) => artifact.id === activeArtifactId) ?? artifacts[0] ?? null;
  if (focusedRootId && focusedRootId !== editingComponentId) {
    syncRootIdRef.current = focusedRootId;
  }
  const screenNameRef = useRef(screenName);
  const targetPathRef = useRef(targetPath);
  const pathSyncSignatureRef = useRef(`${screenName}|${targetPath}`);
  screenNameRef.current = screenName;
  targetPathRef.current = targetPath;

  const canUndo = useDocumentStore((s) => s.past.length > 0);
  const canRedo = useDocumentStore((s) => s.future.length > 0);
  const hasActiveInteraction = useDocumentStore((s) => !!s.interaction);
  const undo = useDocumentStore((s) => s.undo);
  const redo = useDocumentStore((s) => s.redo);

  useEffect(() => startMcpBridge(handleMcpCommand), []);

  useEffect(() => {
    if (inspectorTab === "Props") setInspectorTab("Inspect");
  }, [inspectorTab]);

  useEffect(() => {
    if (flows.length === 0) return;
    const hasManualFlow = flows.some((flow) => flow.id === activeFlow);
    const hasRepoFlow = repoFlowItems.some((flow) => flow.id === activeFlow);
    if (!hasManualFlow && !hasRepoFlow) {
      setActiveFlow(flows[0].id);
    }
  }, [activeFlow, flows, repoFlowItems]);

  useEffect(() => {
    if (artifacts.length && !artifacts.some((artifact) => artifact.id === activeArtifactId)) {
      setActiveArtifactId(artifacts[0].id);
    }
  }, [activeArtifactId, artifacts]);

  const refreshGitStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/git/status");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.repoPath) {
        setRepoPath(body.repoPath);
        setRepoDraft((draft) => draft || body.repoPath);
      }
      setGitStatus({
        status: "ready",
        repoPath: body.repoPath ?? repoPath,
        branch: body.branch ?? "unknown",
        clean: !!body.clean,
        files: Array.isArray(body.files) ? body.files : [],
      });
    } catch (error) {
      setGitStatus({
        status: "error",
        message: error instanceof Error ? error.message : "Git status failed",
      });
    }
  }, [repoPath]);

  const loadRepo = useCallback(async () => {
    try {
      const res = await fetch("/api/repo");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRepoPath(body.repoPath ?? "");
      setRepoDraft(body.repoPath ?? "");
      setRepoContext(body.context ?? null);
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "Repository load failed");
    }
  }, []);

  const loadRepoContext = useCallback(async () => {
    try {
      const res = await fetch("/api/repo/context");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRepoContext(body.context ?? body);
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "Repository scan failed");
    }
  }, []);

  const applyConnectedRepo = useCallback(
    async (body: {
      repoPath?: string;
      git?: Partial<Extract<GitStatus, { status: "ready" }>>;
      context?: RepoContext;
    }, fallbackPath = repoDraft) => {
      const nextPath = body.repoPath ?? fallbackPath;
      setRepoPath(nextPath);
      setRepoDraft(nextPath);
      if (body.git) {
        setGitStatus({
          status: "ready",
          repoPath: body.git.repoPath ?? nextPath,
          branch: body.git.branch ?? "unknown",
          clean: !!body.git.clean,
          files: Array.isArray(body.git.files) ? body.git.files : [],
        });
      } else {
        await refreshGitStatus();
      }
      if (body.context) setRepoContext(body.context);
      else await loadRepoContext();
      skipNextPathSyncRef.current = true;
      const target = body.context?.designSession?.syncTarget ?? body.git?.branch ?? "current branch";
      setStatus(`Connected ${nextPath} · editing ${target}`);
    },
    [loadRepoContext, refreshGitStatus, repoDraft],
  );

  const connectRepo = useCallback(async () => {
    if (codegenBusyRef.current) {
      const message = "Wait for the current sync to finish before changing repositories.";
      setRepoError(message);
      setStatus(message);
      return;
    }
    if (autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current);
      autoSyncTimerRef.current = null;
    }
    skipNextPathSyncRef.current = true;
    setSyncState({ status: "idle" });
    setRepoBusy(true);
    setRepoError(null);
    try {
      const res = await fetch("/api/repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath: repoDraft }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      await applyConnectedRepo(body, repoDraft);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Repository connection failed";
      setRepoError(message);
      setStatus(message);
    } finally {
      setRepoBusy(false);
    }
  }, [applyConnectedRepo, repoDraft]);

  const selectRepoFolder = useCallback(async () => {
    if (codegenBusyRef.current) {
      const message = "Wait for the current sync to finish before changing repositories.";
      setRepoError(message);
      setStatus(message);
      return;
    }
    if (autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current);
      autoSyncTimerRef.current = null;
    }
    skipNextPathSyncRef.current = true;
    setSyncState({ status: "idle" });
    setRepoBusy(true);
    setRepoError(null);
    try {
      const res = await fetch("/api/repo/select-folder", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      await applyConnectedRepo(body, repoDraft);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Folder selection failed";
      setRepoError(message);
      setStatus(message);
    } finally {
      setRepoBusy(false);
    }
  }, [applyConnectedRepo, repoDraft]);

  const loadFlowManifest = useCallback(async () => {
    try {
      const res = await fetch("/api/flows");
      const body = (await res.json()) as FlowManifest & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const next: Partial<Record<FlowId, NodeId>> = {};
      const manifestFlows = Array.isArray(body.flows)
        ? body.flows
            .filter((flow) => typeof flow.id === "string" && typeof flow.label === "string")
            .map((flow) => ({ id: flow.id, label: flow.label }))
        : [];
      for (const flow of body.flows ?? []) {
        if (flow.entryRootId) next[flow.id] = flow.entryRootId;
      }
      if (manifestFlows.length > 0) {
        setFlows(manifestFlows);
        setActiveFlow((current) =>
          manifestFlows.some((flow) => flow.id === current) ? current : manifestFlows[0].id,
        );
      }
      setFlowEntrypoints(next);
    } catch {
      // A missing flow manifest is fine; flows start from inferred screen order.
    }
  }, []);

  const persistFlowManifest = useCallback(
    async (
      nextFlows: FlowDefinition[] = flows,
      entrypoints: Partial<Record<FlowId, NodeId>> = flowEntrypoints,
    ) => {
      const screenRoots = Object.values(roots).filter((root) => root.id !== editingComponentId);
      const manifest: FlowManifest = {
        version: 1,
        flows: nextFlows.map((flow) => {
          const routeScreens = orderedFlowScreens(
            flowScreens(screenRoots, flow.id),
            entrypoints[flow.id],
          );
          const entry = routeScreens[0];
          return {
            id: flow.id,
            label: flow.label,
            entryRootId: entry?.id,
            entryName: entry?.design?.name,
            routes: routeScreens.map((root, index) => ({
              rootId: root.id,
              name: root.design?.name ?? `Screen ${index + 1}`,
            })),
          };
        }),
      };
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifest }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      void refreshGitStatus();
      void loadRepoContext();
    },
    [editingComponentId, flowEntrypoints, flows, loadRepoContext, refreshGitStatus, roots],
  );

  useEffect(() => {
    void loadRepo();
    void refreshGitStatus();
    void loadFlowManifest();
    const timer = setInterval(() => void refreshGitStatus(), 5_000);
    return () => clearInterval(timer);
  }, [loadFlowManifest, loadRepo, refreshGitStatus]);

  // Single-writer canonical token file (Phase 2D-2b): the tool writes `theme.ts`
  // beside the sidecar whenever the token registry changes. Debounced and
  // fire-and-forget — token edits are occasional and this never touches the canvas
  // interaction hot path (it fires only when the `tokens` slice reference changes).
  const sidecarPathRef = useRef(sidecarPath);
  sidecarPathRef.current = sidecarPath;
  // Set just before a `loadRoots` so the writer does NOT echo a freshly *read*
  // registry back to disk (which would clobber the file we just loaded — e.g. the
  // empty seed registry overwriting an existing theme.ts on app start).
  const skipTokenWriteRef = useRef(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastTokens = useDocumentStore.getState().tokens;
    const unsubscribe = useDocumentStore.subscribe((state) => {
      if (state.tokens === lastTokens) return;
      lastTokens = state.tokens;
      if (skipTokenWriteRef.current) {
        skipTokenWriteRef.current = false; // this change was a load, not an edit
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const path = sidecarPathRef.current;
        if (!path) return;
        void fetch("/api/tokens/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sidecarPath: path, tokens: useDocumentStore.getState().tokens }),
        }).catch(() => {});
      }, 400);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  const onMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
    // Keep tldraw's own canvas affordances light and gridded by default.
    editor.user.updateUserPreferences({ colorScheme: "light" });
    editor.updateInstanceState({ isGridMode: true });

    const store = useDocumentStore.getState();
    if (Object.keys(store.roots).length === 0) {
      const seed = createScreenFrame([
        createNode("Text", { props: { text: "Hello RN Canvas" } }),
      ]);
      skipTokenWriteRef.current = true; // seed load — don't write theme.ts
      skipCodeSyncRef.current = true; // seed load — don't write generated files
      store.loadRoots({ [seed.id]: seed }, [seed.id]);
    }
    syncShapes(editor);
    if (store.selection.length === 0) store.setSelection(Object.keys(store.roots).slice(0, 1));

    // Canvas → store: selecting a frame selects its root node (unless the current
    // selection already lives in that frame, e.g. a child node is selected).
    editor.store.listen(
      () => {
        if (reconcilingShapesRef.current) return;
        const selectedShapes = editor.getSelectedShapes();
        if (selectedShapes.length === 0) return;
        if (selectedShapes.length !== 1) return;
        const sel = selectedShapes[0];
        if (!isFrame(sel)) return;
        const rootId = asFrame(sel).props.rootId;
        const s = useDocumentStore.getState();
        const curRoot = findRootContaining(Object.values(s.roots), s.selection[0] ?? "");
        if (curRoot?.id !== rootId) s.setSelection([rootId]);
      },
      { scope: "session" },
    );

    const updateCanvasHistory = () => {
      setCanvasCanUndo(editor.getCanUndo());
      setCanvasCanRedo(editor.getCanRedo());
    };
    editor.store.listen(updateCanvasHistory, { scope: "document" });
    updateCanvasHistory();
  }, []);

  const undoAvailable = canUndo || canvasCanUndo || hasActiveInteraction;
  const redoAvailable = canRedo || canvasCanRedo;

  const undoLatest = useCallback(() => {
    const store = useDocumentStore.getState();
    if (store.interaction) store.commitInteraction();
    if (useDocumentStore.getState().canUndo()) undo();
    else if (editorRef.current) stepCanvasHistory(editorRef.current, "undo");
  }, [undo]);

  const redoLatest = useCallback(() => {
    if (useDocumentStore.getState().canRedo()) redo();
    else if (editorRef.current) stepCanvasHistory(editorRef.current, "redo");
  }, [redo]);

  const resetCanvasHistory = useCallback(() => {
    editorRef.current?.clearHistory();
    setCanvasCanUndo(false);
    setCanvasCanRedo(false);
  }, []);

  const createToken = useCallback((category: "color" | "spacing" | "fontSize") => {
    const state = useDocumentStore.getState();
    const base = category === "color" ? "color" : category === "spacing" ? "space" : "text";
    const taken = new Set(
      Object.values(state.tokens)
        .filter((token) => token.category === category)
        .map((token) => token.name),
    );
    let name = `${base}1`;
    for (let i = 2; taken.has(name); i += 1) name = `${base}${i}`;
    const value = category === "color" ? "#3b82f6" : category === "spacing" ? 8 : 16;
    state.addToken({ id: crypto.randomUUID(), name, category, value });
    setWorkspace("Design System");
    setActiveDesignSystemView(
      category === "color" ? "Colors" : category === "spacing" ? "Spacing" : "Typography",
    );
    setStatus(`Added ${name}`);
  }, []);

  const selectScreenFromWorkspace = useCallback((rootId: NodeId) => {
    pendingFocusRootIdRef.current = rootId;
    useDocumentStore.getState().setSelection([rootId]);
    setWorkspace("Screen");
    setInspectorTab("Inspect");
    setStatus("Opened screen");
  }, []);

  const openChangesPanel = useCallback(() => {
    setInspectorTab("History");
    setStatus("Showing changes");
  }, []);

  const setFlowEntryRoot = useCallback((rootId: NodeId) => {
    setFlowEntrypoints((current) => {
      const next = { ...current, [activeFlow]: rootId };
      void persistFlowManifest(flows, next).then(
        () => setStatus("Updated flow entrypoint"),
        (error) =>
          setStatus(error instanceof Error ? error.message : "Flow manifest save failed"),
      );
      return next;
    });
  }, [activeFlow, flows, persistFlowManifest]);

  const addFlow = useCallback(() => {
    setFlows((current) => {
      const labelBase = "New Flow";
      const takenLabels = new Set(current.map((flow) => flow.label));
      let label = labelBase;
      for (let i = 2; takenLabels.has(label); i += 1) label = `${labelBase} ${i}`;
      const nextFlow: FlowDefinition = {
        id: slugFlowId(label, new Set(current.map((flow) => flow.id))),
        label,
        description: "Prototype route order for this screen group.",
      };
      const next = [...current, nextFlow];
      void persistFlowManifest(next, flowEntrypoints).then(
        () => setStatus(`Added ${label}`),
        (error) =>
          setStatus(error instanceof Error ? error.message : "Flow manifest save failed"),
      );
      setActiveFlow(nextFlow.id);
      setPendingRemoveFlowId(null);
      setWorkspace("Flow");
      return next;
    });
  }, [flowEntrypoints, persistFlowManifest]);

  const removeFlow = useCallback(
    (flow: FlowPanelItem) => {
      if (flows.length <= 1) {
        setStatus("Keep at least one flow.");
        return;
      }
      const screenRoots = Object.values(roots).filter((root) => root.id !== editingComponentId);
      const screenCount = flow.screenCount ?? flowScreens(screenRoots, flow.id).length;
      if (screenCount > 1 && pendingRemoveFlowId !== flow.id) {
        setPendingRemoveFlowId(flow.id);
        setStatus(`Confirm removal of ${flow.label}`);
        return;
      }
      const nextFlows = flows.filter((item) => item.id !== flow.id);
      const nextEntrypoints = { ...flowEntrypoints };
      delete nextEntrypoints[flow.id];
      const nextActiveFlow = activeFlow === flow.id ? nextFlows[0]?.id : activeFlow;
      if (!nextActiveFlow) {
        setStatus("Keep at least one flow.");
        return;
      }
      setFlows(nextFlows);
      setFlowEntrypoints(nextEntrypoints);
      setPendingRemoveFlowId(null);
      setActiveFlow(nextActiveFlow);
      void persistFlowManifest(nextFlows, nextEntrypoints).then(
        () => setStatus(`Removed ${flow.label}`),
        (error) =>
          setStatus(error instanceof Error ? error.message : "Flow manifest save failed"),
      );
    },
    [activeFlow, editingComponentId, flowEntrypoints, flows, pendingRemoveFlowId, persistFlowManifest, roots],
  );

  // Store → canvas: keep the focused frame selected on the canvas. Guarded so it
  // can't ping-pong with the listener above.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !focusedRoot) return;
    const selectedId = selection[0] ?? "";
    if (pendingFocusRootIdRef.current === focusedRoot.id) {
      if (focusRootFrame(editor, focusedRoot.id)) pendingFocusRootIdRef.current = null;
      return;
    }
    syncCanvasFrameSelection(editor, focusedRoot.id, selectedId === focusedRoot.id);
  }, [focusedRoot, selection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const store = useDocumentStore.getState();
      const modifier = event.metaKey || event.ctrlKey;

      // Single-key tool shortcuts (Figma-style, no modifier). V/Select disarms
      // any active create-tool; F creates a new screen; R/T/I arm a primitive
      // for the next canvas drag. Esc clears an armed tool.
      if (!modifier && !event.altKey && !event.shiftKey && event.key.length === 1) {
        const studio = useStudioStore.getState();
        const k = event.key.toLowerCase();
        if (k === "v") {
          event.preventDefault();
          studio.setArmedTool(null);
          editorRef.current?.setCurrentTool("select");
          setStatus("Select tool");
          return;
        }
        if (k === "f") {
          event.preventDefault();
          addFrame();
          setStatus("Added screen");
          return;
        }
        if (k === "r") {
          event.preventDefault();
          studio.setArmedTool("View");
          setStatus("View — drag to draw");
          return;
        }
        if (k === "t") {
          event.preventDefault();
          studio.setArmedTool("Text");
          setStatus("Text — drag to draw");
          return;
        }
        if (k === "i") {
          event.preventDefault();
          studio.setArmedTool("Image");
          setStatus("Image — drag to draw");
          return;
        }
      }
      if (event.key === "Escape" && !modifier) {
        const studio = useStudioStore.getState();
        if (studio.armedTool || studio.armedComponentId) {
          event.preventDefault();
          studio.setArmedTool(null);
          studio.setArmedComponent(null);
          setStatus("Tool disarmed");
          return;
        }
      }

      if (modifier && event.key.toLowerCase() === "z") {
        const redoRequested = event.shiftKey;
        const documentAvailable = redoRequested ? store.canRedo() : store.canUndo();
        const editor = editorRef.current;
        const canvasAvailable = editor
          ? redoRequested
            ? editor.getCanRedo()
            : editor.getCanUndo()
          : false;
        if (documentAvailable || canvasAvailable) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (documentAvailable) {
            if (redoRequested) store.redo();
            else store.undo();
          } else {
            stepCanvasHistory(editor!, redoRequested ? "redo" : "undo");
          }
          setStatus(redoRequested ? "Redid change" : "Undid change");
        }
        return;
      }

      // Duplicate selected document nodes (⌘/Ctrl-D).
      if (modifier && event.key.toLowerCase() === "d") {
        const focused = findRootContaining(Object.values(store.roots), store.selection[0] ?? "");
        const nodeIds = focused
          ? normalizeNodeSelection(focused, store.selection, { excludeRoot: true })
          : [];
        if (nodeIds.length > 0) {
          event.preventDefault();
          event.stopImmediatePropagation();
          duplicateNodes(focused!.id, nodeIds);
          setStatus(`Duplicated ${nodeIds.length} layer${nodeIds.length === 1 ? "" : "s"}`);
        }
        return;
      }

      // In Yoga flow, arrow keys reorder along the parent's visual flex axis.
      // Absolute children keep the normal positional model and are not reordered.
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        const focused = findRootContaining(Object.values(store.roots), store.selection[0] ?? "");
        const nodeIds = focused
          ? normalizeNodeSelection(focused, store.selection, { excludeRoot: true })
          : [];
        const node = focused && nodeIds.length === 1 ? findNode(focused, nodeIds[0]) : undefined;
        const parent = focused && node ? getParent(focused, node.id) : undefined;
        if (focused && node && parent && node.style.position !== "absolute") {
          event.preventDefault();
          event.stopImmediatePropagation();
          const direction = parent.style.flexDirection ?? "column";
          const horizontal = direction.startsWith("row");
          const reverse = direction.endsWith("reverse");
          const matchesAxis = horizontal
            ? event.key === "ArrowLeft" || event.key === "ArrowRight"
            : event.key === "ArrowUp" || event.key === "ArrowDown";
          if (matchesAxis) {
            const towardEnd = horizontal ? event.key === "ArrowRight" : event.key === "ArrowDown";
            const offset = (towardEnd !== reverse ? 1 : -1) as -1 | 1;
            if (reorderNode(focused.id, node.id, offset)) {
              const directionLabel = event.key.replace("Arrow", "").toLowerCase();
              setStatus(`Moved ${node.design?.name ?? node.type} ${directionLabel}`);
            }
          }
        }
        return;
      }

      if (event.key !== "Backspace" && event.key !== "Delete") return;

      // Delete selected document nodes first; only fall back to frame deletion
      // when the selection is the frame itself (no inner node selected).
      const focused = findRootContaining(Object.values(store.roots), store.selection[0] ?? "");
      const nodeIds = focused
        ? normalizeNodeSelection(focused, store.selection, { excludeRoot: true }).filter(
            (id) => !findNode(focused, id)?.design?.locked,
          )
        : [];
      if (nodeIds.length > 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        deleteNodes(focused!.id, nodeIds);
        setStatus(`Deleted ${nodeIds.length} layer${nodeIds.length === 1 ? "" : "s"}`);
        return;
      }

      const editor = editorRef.current;
      if (!editor) return;
      const selectedRootIds = editor
        .getSelectedShapes()
        .filter(isFrame)
        .map((shape) => asFrame(shape).props.rootId)
        .filter((rootId) => {
          const root = store.roots[rootId];
          return !!root && !root.design?.locked;
        });
      if (selectedRootIds.length === 0) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      store.beginInteraction();
      try {
        for (const rootId of selectedRootIds) {
          useDocumentStore.getState().removeRoot(rootId);
        }
        useDocumentStore.getState().commitInteraction();
      } catch (error) {
        useDocumentStore.getState().cancelInteraction();
        throw error;
      }
      const remaining = Object.keys(useDocumentStore.getState().roots);
      useDocumentStore.getState().setSelection(remaining.slice(0, 1));
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Reconcile shapes with roots: add shapes for new roots, prune shapes whose root
  // is gone (e.g. undo of Add frame), and mirror design.locked → shape lock.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    reconcilingShapesRef.current = true;
    try {
      editor.run(
        () => {
          createMissingShapes(editor, roots);
          for (const shape of editor.getCurrentPageShapes()) {
            if (!isFrame(shape)) continue;
            const root = roots[asFrame(shape).props.rootId];
            if (!root) {
              editor.deleteShapes([shape.id]);
              continue;
            }
            const shouldLock = !!root.design?.locked;
            if (shape.isLocked !== shouldLock) {
              editor.updateShape({
                id: shape.id,
                type: FRAME_TYPE,
                isLocked: shouldLock,
              } as unknown as UpdatePartial);
            }
            // Mirror the screen size from the root so a document undo of a frame
            // resize restores the box too. Only when it differs (a live drag has
            // already matched them, so this won't fight tldraw mid-gesture).
            const frame = asFrame(shape);
            const { w, h } = rootSize(root);
            if (frame.props.w !== w || frame.props.h !== h) {
              editor.updateShape({
                id: shape.id,
                type: FRAME_TYPE,
                props: { ...frame.props, w, h },
              } as unknown as UpdatePartial);
            }
          }
          const selectedId = useDocumentStore.getState().selection[0] ?? "";
          const selectedRoot = findRootContaining(Object.values(roots), selectedId);
          if (selectedRoot) {
            if (pendingFocusRootIdRef.current === selectedRoot.id) {
              if (focusRootFrame(editor, selectedRoot.id)) pendingFocusRootIdRef.current = null;
            } else {
              syncCanvasFrameSelection(editor, selectedRoot.id, selectedId === selectedRoot.id);
            }
          }
        },
        { history: "ignore", ignoreShapeLock: true },
      );
    } finally {
      reconcilingShapesRef.current = false;
    }
  }, [roots]);

  const addFrame = useCallback(() => {
    const root = createScreenFrame();
    const store = useDocumentStore.getState();
    pendingFocusRootIdRef.current = root.id;
    store.addRoot(root);
    store.setSelection([root.id]);
  }, []);

  const selectTool = useCallback(() => {
    editorRef.current?.setCurrentTool("select");
    setStatus("Select tool active");
  }, []);

  const syncRoot = useCallback(() => {
    const state = useDocumentStore.getState();
    const rememberedRoot = syncRootIdRef.current ? state.roots[syncRootIdRef.current] : null;
    if (rememberedRoot && rememberedRoot.id !== state.editingComponentId) return rememberedRoot;
    return Object.values(state.roots).find((root) => root.id !== state.editingComponentId) ?? null;
  }, []);

  const requestCodegen = useCallback(
    async (mode: "preview" | "sync", source: "manual" | "auto" = "manual") => {
      const root = syncRoot();
      if (!root) {
        const message = "Select a screen before syncing.";
        setCodegenError(message);
        if (mode === "sync") setSyncState({ status: "error", message });
        setStatus(message);
        return null;
      }
      if (codegenBusyRef.current) return null;
      codegenBusyRef.current = true;
      setCodegenBusy(true);
      setCodegenError(null);
      if (mode === "sync") setSyncState({ status: "syncing" });
      try {
        const state = useDocumentStore.getState();
        const res = await fetch(`/api/codegen/${mode}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            root,
            screenName: screenNameRef.current,
            targetPath: targetPathRef.current,
            components: state.components,
            tokens: state.tokens,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setCodegenResult(body);
        if (source === "manual") setActiveArtifactId("screen");
        if (mode === "sync") setSyncState({ status: "synced", path: body.targetPath });
        if (mode === "sync") {
          void refreshGitStatus();
          void loadRepoContext();
        }
        setStatus(
          mode === "sync"
            ? `${source === "auto" ? "Autosynced" : "Synced"} ${body.targetPath} + ${body.sidecarPath}`
            : `Previewed sync for ${body.targetPath}`,
        );
        return body as CodegenResult;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Sync failed";
        setCodegenError(message);
        if (mode === "sync") setSyncState({ status: "error", message });
        setStatus(message);
        return null;
      } finally {
        codegenBusyRef.current = false;
        setCodegenBusy(false);
      }
    },
    [loadRepoContext, refreshGitStatus, syncRoot],
  );

  const openSidecar = useCallback(async (path = sidecarPath) => {
    setCodegenBusy(true);
    setCodegenError(null);
    try {
      const res = await fetch("/api/documents/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sidecarPath: path }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const opened = body as OpenDocumentResult;
      // The file is the canonical token source: we just read it, so don't echo it
      // straight back out (the writer fires only on subsequent in-tool edits).
      skipTokenWriteRef.current = true;
      skipCodeSyncRef.current = true;
      skipNextPathSyncRef.current = true;
      useDocumentStore.getState().loadRoots(
        { [opened.root.id]: opened.root },
        [opened.root.id],
        opened.components,
        opened.tokens,
      );
      resetCanvasHistory();
      setScreenName(opened.screenName);
      if (opened.repoPath) {
        setRepoPath(opened.repoPath);
        setRepoDraft(opened.repoPath);
      }
      setTargetPath(opened.targetPath);
      setSidecarPath(opened.sidecarPath);
      setCodegenResult(null);
      setActiveArtifactId("screen");
      void loadRepoContext();
      setStatus(`Opened ${opened.sidecarPath}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Document load failed";
      setCodegenError(message);
      setStatus(message);
    } finally {
      setCodegenBusy(false);
    }
  }, [loadRepoContext, resetCanvasHistory, sidecarPath]);

  const importSource = useCallback(async (path = targetPath) => {
    setCodegenBusy(true);
    setCodegenError(null);
    try {
      const res = await fetch("/api/documents/import-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath: path }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const imported = body as ImportSourceResult;
      skipTokenWriteRef.current = true; // imported document load — not a token edit
      skipCodeSyncRef.current = true; // imported document load — not a canvas edit
      skipNextPathSyncRef.current = true;
      useDocumentStore.getState().loadRoots(
        { [imported.root.id]: imported.root },
        [imported.root.id],
      );
      resetCanvasHistory();
      setScreenName(imported.screenName);
      if (imported.repoPath) {
        setRepoPath(imported.repoPath);
        setRepoDraft(imported.repoPath);
      }
      setTargetPath(imported.sourcePath);
      setSidecarPath(imported.sidecarPath);
      setCodegenResult(null);
      setActiveArtifactId("screen");
      void loadRepoContext();
      setStatus(`Imported ${imported.sourcePath}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Code import failed";
      setCodegenError(message);
      setStatus(message);
    } finally {
      setCodegenBusy(false);
    }
  }, [loadRepoContext, resetCanvasHistory, targetPath]);

  const openRepoSettings = useCallback(() => {
    setInspectorTab("Code");
    setStatus("Repository settings");
  }, []);

  const openRepoScreen = useCallback(
    (screen: NonNullable<RepoContext>["screens"][number]) => {
      setWorkspace("Screen");
      if (screen.sidecarPath) {
        void openSidecar(screen.sidecarPath);
        return;
      }
      void importSource(screen.path);
    },
    [importSource, openSidecar],
  );

  const scheduleAutoSync = useCallback(() => {
    if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
    setSyncState({ status: "scheduled" });
    autoSyncTimerRef.current = setTimeout(() => {
      autoSyncTimerRef.current = null;
      if (codegenBusyRef.current) {
        scheduleAutoSync();
        return;
      }
      void requestCodegen("sync", "auto");
    }, 900);
  }, [requestCodegen]);

  useEffect(() => {
    let lastRoots = useDocumentStore.getState().roots;
    let lastComponents = useDocumentStore.getState().components;
    let lastTokens = useDocumentStore.getState().tokens;
    let lastInteraction = useDocumentStore.getState().interaction;
    let dirtyDuringInteraction = false;
    const unsubscribe = useDocumentStore.subscribe((state) => {
      const documentChanged =
        state.roots !== lastRoots ||
        state.components !== lastComponents ||
        state.tokens !== lastTokens;
      const interactionJustEnded = !!lastInteraction && !state.interaction;
      lastRoots = state.roots;
      lastComponents = state.components;
      lastTokens = state.tokens;
      lastInteraction = state.interaction;
      if (interactionJustEnded && dirtyDuringInteraction) {
        dirtyDuringInteraction = false;
        scheduleAutoSync();
        return;
      }
      if (!documentChanged) return;
      if (skipCodeSyncRef.current) {
        skipCodeSyncRef.current = false;
        return;
      }
      if (state.interaction) {
        dirtyDuringInteraction = true;
        return;
      }
      scheduleAutoSync();
    });
    return () => {
      if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
      unsubscribe();
    };
  }, [scheduleAutoSync]);

  useEffect(() => {
    const signature = `${screenName}|${targetPath}`;
    if (signature === pathSyncSignatureRef.current) return;
    pathSyncSignatureRef.current = signature;
    if (skipNextPathSyncRef.current) {
      skipNextPathSyncRef.current = false;
      return;
    }
    if (!Object.keys(useDocumentStore.getState().roots).length) return;
    scheduleAutoSync();
  }, [screenName, targetPath, scheduleAutoSync]);

  const syncLabel =
    syncState.status === "scheduled"
      ? "Sync pending"
      : syncState.status === "syncing"
        ? "Syncing"
        : syncState.status === "synced"
          ? `Synced ${syncState.path}`
          : syncState.status === "error"
            ? "Sync failed"
            : "Ready";
  const gitLabel = gitSummary(gitStatus);
  const gitTone =
    gitStatus.status === "error" ? "amber" : gitStatus.status === "ready" && !gitStatus.clean ? "accent" : "neutral";
  const syncTone =
    syncState.status === "error" ? "amber" : syncState.status === "syncing" || syncState.status === "scheduled" ? "accent" : "neutral";
  const repoName = repoContext?.repoName ?? "Repository";
  const frameworkLabels = repoContext?.frameworks.map((framework) => framework.label) ?? [];
  const syncTarget = repoContext?.designSession?.syncTarget;
  const repoSubtitle =
    frameworkLabels.length > 0
      ? `${frameworkLabels.slice(0, 3).join(" · ")}${frameworkLabels.length > 3 ? ` +${frameworkLabels.length - 3}` : ""}${syncTarget ? ` · ${syncTarget}` : ""}`
      : repoContext?.packageManager
        ? `No app runtime detected · ${repoContext.packageManager}${syncTarget ? ` · ${syncTarget}` : ""}`
        : "Attach a repo";
  const repoGitCode = firstGitCode(gitStatus);

  return (
    <div
      style={{
        height: "100vh",
        minWidth: layout.workspaceMin,
        display: "flex",
        flexDirection: "column",
        background: color.canvas,
      }}
    >
      {/* TOP BAR */}
      <header
        className="studio-chrome flex items-center gap-lg border-b border-line bg-chrome px-xl"
        style={{
          flex: "0 0 64px",
          height: 64,
        }}
      >
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-xs">
            <strong className="min-w-0 truncate text-xl font-semibold text-ink">
              {repoName}
            </strong>
            {repoGitCode && (
              <span
                title="Repository has changes"
                aria-label="Repository has changes"
                className="flex size-1 shrink-0 rounded-full bg-accent"
              />
            )}
            <IconButton
              title={repoContext ? "Change connected repo" : "Connect repo"}
              onClick={openRepoSettings}
            >
              <FolderOpen size={14} aria-hidden="true" />
            </IconButton>
          </div>
          <span className="truncate text-xs text-ink-faint" title={repoContext?.repoPath}>
            {repoSubtitle}
          </span>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-sm">
          <StatusPill
            tone={gitTone}
            title={gitStatus.status === "error" ? gitStatus.message : gitLabel}
          >
            {gitLabel}
          </StatusPill>
          <StatusPill
            tone={syncTone}
            title={syncState.status === "error" ? syncState.message : syncLabel}
          >
            {syncLabel}
          </StatusPill>
        </div>
        <div className="flex items-center gap-xs border-l border-line-soft pl-md">
          <IconButton
            disabled={!undoAvailable}
            onClick={undoLatest}
            title="Undo"
          >
            <Undo2 size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            disabled={!redoAvailable}
            onClick={redoLatest}
            title="Redo"
          >
            <Redo2 size={16} aria-hidden="true" />
          </IconButton>
        </div>
        <div className="flex min-w-0 items-center gap-sm border-l border-line-soft pl-md">
          <IconButton
            title="Preview generated code"
            onClick={() => {
              setInspectorTab("Code");
              void requestCodegen("preview");
            }}
            disabled={codegenBusy || !focusedRoot}
          >
            <Play size={15} aria-hidden="true" />
          </IconButton>
          <Button
            variant="primary"
            disabled={codegenBusy || !focusedRoot}
            title="Sync generated files"
            onClick={() => void requestCodegen("sync")}
          >
            <Save size={14} aria-hidden="true" /> Sync
          </Button>
        </div>
      </header>

      {/* WORKBENCH: left panel · canvas (with floating bottom toolbar) · right column */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <LeftPanel
          workspace={workspace}
          onWorkspaceChange={setWorkspace}
          onAddFrame={addFrame}
          activeFlow={activeFlow}
          onFlowChange={setActiveFlow}
          flows={flowPanelItems}
          onAddFlow={addFlow}
          onRemoveFlow={removeFlow}
          onCancelRemoveFlow={() => setPendingRemoveFlowId(null)}
          pendingRemoveFlowId={pendingRemoveFlowId}
          activeDesignSystemView={activeDesignSystemView}
          onDesignSystemViewChange={setActiveDesignSystemView}
          onOpenChanges={openChangesPanel}
          onOpenRepoScreen={openRepoScreen}
          gitStatus={gitStatus}
          targetPath={targetPath}
          sidecarPath={sidecarPath}
          repoContext={repoContext}
        />

        <div className="relative flex min-w-0 flex-1 flex-col">
          {workspace === "Flow" ? (
            <FlowWorkspace
              roots={Object.values(roots)}
              components={componentRegistry}
              flows={flows}
              repoFlows={repoFlowItems}
              activeFlow={activeFlow}
              entryRootId={flowEntrypoints[activeFlow]}
              onSelectScreen={selectScreenFromWorkspace}
              onOpenRepoScreen={openRepoScreen}
              onEntryRootChange={setFlowEntryRoot}
              onAddFrame={addFrame}
            />
          ) : workspace === "Design System" ? (
            <DesignSystemWorkspace
              tokens={Object.values(tokens)}
              activeView={activeDesignSystemView}
              onViewChange={setActiveDesignSystemView}
              onCreateToken={createToken}
            />
          ) : (
            <>
              <ToolRail
                onSelect={selectTool}
                onAddFrame={addFrame}
                // A primitive can be armed whenever there's any screen to draw into —
                // the target frame is resolved from the cursor, not a prior selection.
                canAddPrimitive={Object.keys(roots).length > 0}
              />
              {editingComponentName && (
                <div
                  data-testid="component-edit-banner"
                  className="studio-chrome absolute left-1/2 top-md z-10 flex -translate-x-1/2 items-center gap-md rounded-pill border border-accent-line bg-chrome px-md py-xs text-sm text-ink shadow-popover"
                >
                  <span>
                    Component / <strong>{editingComponentName}</strong>
                  </span>
                  <span className="text-ink-faint">Focused definition</span>
                  <Button
                    variant="ghost"
                    onClick={() => useDocumentStore.getState().endComponentEdit(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => useDocumentStore.getState().endComponentEdit(true)}
                  >
                    Done
                  </Button>
                </div>
              )}
              <div
                data-testid="rn-canvas-surface"
                className="relative min-h-0 flex-1"
                onPointerDownCapture={(event) => {
                  if (event.button !== 0) return;
                  const target = event.target;
                  if (!(target instanceof Element)) return;
                  if (target.closest("[data-rn-root-id]")) return;
                  if (target.closest(".tl-selection__handle")) return;
                  const store = useDocumentStore.getState();
                  if (store.selection.length > 0) store.setSelection([]);
                }}
              >
                <Tldraw
                  onMount={onMount}
                  shapeUtils={shapeUtils}
                  components={components}
                  overrides={overrides}
                />
              </div>
              <div className="studio-chrome flex flex-none items-center gap-md border-t border-line bg-chrome px-md py-xs text-sm">
                <span className="eyebrow">AI Implementation Simulator</span>
                <div className="h-px flex-1 bg-line-soft" aria-hidden="true" />
                <span className="truncate text-ink-dim">{status}</span>
              </div>
            </>
          )}
        </div>

        {/* RIGHT COLUMN: canvas/code inspector. Optional native preview is on demand. */}
        <div
          className="studio-chrome"
          style={{
            flex: `0 0 ${layout.rightColumn}px`,
            width: layout.rightColumn,
            borderLeft: `1px solid ${color.line}`,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: space.md, paddingBottom: 0 }}>
              <div className="mb-xs flex items-center gap-xs">
                <div className="eyebrow min-w-0 flex-1 truncate">Inspector</div>
                {inspectorTab !== "Inspect" && (
                  <span className="text-2xs font-semibold text-ink-faint">
                    {inspectorTab}
                  </span>
                )}
              </div>
              {/* Interact (interactions/navigation) is phase 3 — not shown in v1. */}
              <Tabs
                tabs={["Inspect", "Code", "History"]}
                active={inspectorTab}
                onSelect={setInspectorTab}
                variant="underline"
              />
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
              {inspectorTab === "Inspect" ? (
                <ErrorBoundary label="Inspector" resetKey={selection[0] ?? null}>
                  <Inspector rootId={focusedRootId} />
                </ErrorBoundary>
              ) : inspectorTab === "Code" ? (
                <div
                  style={{
                    padding: space.md,
                    display: "flex",
                    flexDirection: "column",
                    gap: space.md,
                    overflow: "auto",
                    width: "100%",
                  }}
                >
                  <Eyebrow>Code</Eyebrow>
                  <Section title="Repository">
                    <Button
                      className="w-full"
                      disabled={repoBusy || codegenBusy}
                      onClick={() => void selectRepoFolder()}
                    >
                      <FolderOpen size={14} aria-hidden="true" /> Select folder
                    </Button>
                    <Field label="Connected repo" stacked>
                      <TextField
                        value={repoDraft}
                        onChange={setRepoDraft}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void connectRepo();
                          else if (e.key === "Escape") setRepoDraft(repoPath);
                        }}
                        placeholder="/path/to/app"
                        spellCheck={false}
                      />
                    </Field>
                    <div className="flex gap-xs">
                      <Button
                        className="flex-1"
                        disabled={repoBusy || codegenBusy || !repoDraft.trim()}
                        onClick={() => void connectRepo()}
                      >
                        Connect path
                      </Button>
                      <IconButton
                        title="Refresh Git status"
                        onClick={() => void refreshGitStatus()}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                      </IconButton>
                    </div>
                    {repoContext?.designSession && (
                      <div className="rounded-sm border border-line-soft bg-raised px-sm py-xs text-xs text-ink-dim">
                        <div className="flex min-w-0 justify-between gap-sm">
                          <span className="text-ink-faint">Sync target</span>
                          <span className="min-w-0 truncate text-ink">{repoContext.designSession.syncTarget}</span>
                        </div>
                        <div className="mt-1 flex min-w-0 justify-between gap-sm">
                          <span className="text-ink-faint">Studio branch</span>
                          <span className="min-w-0 truncate">{repoContext.designSession.suggestedBranch}</span>
                        </div>
                      </div>
                    )}
                    {repoError && (
                      <p className="m-0 text-xs text-amber">
                        {repoError}
                      </p>
                    )}
                  </Section>
                  <Section title="Document">
                    <Field label="Sidecar" stacked>
                      <TextField
                        value={sidecarPath}
                        onChange={setSidecarPath}
                      />
                    </Field>
                    <div className="flex gap-xs">
                      <Button
                        className="flex-1"
                        disabled={codegenBusy}
                        onClick={() => void openSidecar()}
                      >
                        <FolderOpen size={14} aria-hidden="true" /> Open
                      </Button>
                      <Button
                        className="flex-1"
                        disabled={codegenBusy}
                        onClick={() => void importSource()}
                      >
                        <RefreshCw size={14} aria-hidden="true" /> Import
                      </Button>
                    </div>
                  </Section>
                  <Section title="Output">
                    <Field label="Screen" stacked>
                      <TextField
                        value={screenName}
                        onChange={setScreenName}
                        onBlur={() => void requestCodegen("preview")}
                      />
                    </Field>
                    <Field label="Code path" stacked>
                      <TextField
                        value={targetPath}
                        onChange={setTargetPath}
                      />
                    </Field>
                    <div className="flex gap-xs">
                      <Button
                        className="flex-1"
                        disabled={codegenBusy || !focusedRoot}
                        onClick={() => void requestCodegen("preview")}
                      >
                        <FileCode2 size={14} aria-hidden="true" /> Preview
                      </Button>
                      <Button
                        variant="primary"
                        className="flex-1"
                        disabled={codegenBusy || !focusedRoot}
                        onClick={() => void requestCodegen("sync")}
                      >
                        <Save size={14} aria-hidden="true" /> Sync
                      </Button>
                    </div>
                  </Section>
                  {codegenError && (
                    <p className="m-0 rounded-sm border border-amber/40 bg-amber/10 px-sm py-xs text-xs text-amber">
                      {codegenError}
                    </p>
                  )}
                  <div className="flex flex-col gap-xs rounded-sm border border-line bg-chrome-2 p-sm">
                    <div className="flex items-center gap-sm">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-ink">Repository</div>
                        <div className="text-xs text-ink-faint">{gitLabel}</div>
                        {repoPath && (
                          <div
                            title={repoPath}
                            className="truncate text-xs text-ink-faint"
                          >
                            {repoPath}
                          </div>
                        )}
                      </div>
                      <IconButton
                        title="Refresh Git status"
                        onClick={() => void refreshGitStatus()}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                      </IconButton>
                    </div>
                    {gitStatus.status === "ready" && !gitStatus.clean && (
                      <div className="flex flex-col gap-xs">
                        {gitStatus.files.slice(0, 8).map((file) => (
                          <div
                            key={`${file.index}${file.workingTree}-${file.path}`}
                            className="flex items-center gap-xs text-xs text-ink-dim"
                          >
                            <span className="shrink-0 uppercase text-ink-faint">
                              {gitFileStatusLabel(file)}
                            </span>
                            <span
                              className="min-w-0 flex-1 truncate"
                              title={file.path}
                            >
                              {file.path}
                            </span>
                          </div>
                        ))}
                        {gitStatus.files.length > 8 && (
                          <div className="text-xs text-ink-faint">
                            +{gitStatus.files.length - 8} more
                          </div>
                        )}
                      </div>
                    )}
                    {gitStatus.status === "error" && (
                      <p className="m-0 text-xs text-amber">
                        {gitStatus.message}
                      </p>
                    )}
                  </div>
                  {codegenResult ? (
                    <div className="flex min-h-0 flex-col gap-sm">
                      <p className="m-0 text-xs text-ink-faint">
                        {codegenResult.wrote ? "Synced" : "Previewing"} {artifacts.length}{" "}
                        {artifacts.length === 1 ? "file" : "files"}.
                      </p>
                      <div className="flex flex-col gap-xs">
                        {artifacts.map((artifact) => {
                          const active = artifact.id === activeArtifact?.id;
                          const Icon = artifact.kind === "json" ? FileJson2 : FileCode2;
                          return (
                            <button
                              key={artifact.id}
                              type="button"
                              onClick={() => setActiveArtifactId(artifact.id)}
                              className={cn(
                                "flex h-7 w-full items-center gap-xs rounded-sm border px-sm text-left text-xs transition-colors",
                                active
                                  ? "border-accent-line bg-accent-soft text-accent"
                                  : "border-line bg-chrome-2 text-ink-dim hover:bg-raised hover:text-ink",
                              )}
                            >
                              <Icon size={14} aria-hidden="true" />
                              <span className="min-w-0 flex-1 truncate">
                                {artifact.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {activeArtifact && (
                        <div className="flex min-h-[260px] flex-1 flex-col">
                          <div className="flex items-center gap-xs rounded-t-sm border border-line border-b-0 bg-chrome-2 px-sm py-xs text-xs text-ink">
                            <span className="min-w-0 flex-1 truncate">
                              {activeArtifact.path}
                            </span>
                            <span className="uppercase text-ink-faint">
                              {activeArtifact.kind}
                            </span>
                          </div>
                          <pre className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-b-sm border border-line bg-canvas p-md text-xs leading-[1.55] text-ink-dim">
                            {activeArtifact.code}
                          </pre>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-sm border border-line bg-chrome-2 p-md text-sm text-ink-faint">
                      Preview or sync to inspect code-linked files.
                    </div>
                  )}
                </div>
              ) : (
                <ChangesTimeline
                  gitStatus={gitStatus}
                  repoPath={repoPath}
                  repoContext={repoContext}
                  onRefresh={() => void refreshGitStatus()}
                  onOpenCode={() => setInspectorTab("Code")}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
