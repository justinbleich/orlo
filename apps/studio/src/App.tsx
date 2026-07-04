import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  FileCode2,
  FileJson2,
  FolderOpen,
  Play,
  RefreshCw,
  Redo2,
  Save,
  Trash2,
  Undo2,
  X,
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
  type DesignToken,
  type Node,
  type NodeId,
  type RNPrimitive,
  type TokenCategory,
} from "@rn-canvas/document";
import { FrameShapeUtil, type FrameShape } from "./shapes/FrameShape";
import { FlowCanvas } from "./FlowCanvas";
import { FlowInspector } from "./FlowInspector";
import { CodePanel } from "./CodePanel";
import { gitFileStatusLabel, type GitFileStatus, type GitStatus } from "./code-artifacts";
import {
  initWorkspaceSubscriptions,
  registerStudioHooks,
  setSyncRootHint,
  useWorkspaceStore,
  workspaceFlags,
  type ActiveRepoScreen,
  type FlowDefinition,
} from "./workspace-store";
import { Inspector } from "./Inspector";
import { ErrorBoundary } from "./ErrorBoundary";
import { LayerContextMenu } from "./LayerContextMenu";
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
  firstGitCode,
  gitSummary,
  pathLabel,
  repoChangesForContext,
  repoFlowItemsForContext,
  scopedPathLabel,
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
  TooltipProvider,
  cn,
} from "./studio-ui";
import { absoluteConstraintMode, absoluteMovePatch } from "@rn-canvas/styles";
import { deleteNodes, duplicateNodes, reorderNode } from "./document-actions";
import { startMcpBridge } from "./mcp-bridge";
import { handleMcpCommand } from "./mcp-command-handler";
import {
  addFlowRoute,
  flowAvailableScreens,
  flowRouteScreens,
  flowScreenName,
  removeFlowRoute,
  reorderFlowRoute,
} from "./flow-model";
import type { FlowManifest } from "./repo-contract";
import {
  firstSelectableChild,
  nextLayerSelection,
  normalizeNodeSelection,
  parentLayerSelection,
} from "./selection";
import { type CanvasTool, useStudioStore } from "./studio-store";

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

type RepoContext = RepoPanelContext;

type WorkspaceMode = "Screen" | "Component" | "Flow" | "Design System";

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
function createScreenFrame(children: Node[] = [], name?: string): Node {
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
    design: name ? { name } : undefined,
    children,
  });
}

/** Create a tldraw shape for any document root that doesn't have one yet. */
function createMissingShapes(editor: Editor, roots: Record<NodeId, Node>) {
  const existing = new Set(
    editor
      .getCurrentPageShapes()
      .filter(isFrame)
      .map((s) => asFrame(s).props.rootId),
  );
  const store = useDocumentStore.getState();
  const seeded: Record<NodeId, { x: number; y: number }> = {};
  let i = existing.size;
  for (const root of Object.values(roots)) {
    if (existing.has(root.id)) continue;
    const { w, h } = rootSize(root);
    // Stored position wins (persisted arrangement / undo state); new frames get
    // the grid slot, recorded back so the layout is durable from the start.
    const stored = store.framePositions[root.id];
    const x = stored?.x ?? 80 + (i % 3) * (DEVICE_FRAME.width + 50);
    const y = stored?.y ?? 80 + Math.floor(i / 3) * (DEVICE_FRAME.height + 56);
    if (!stored) seeded[root.id] = { x, y };
    editor.createShape({
      id: createShapeId(),
      type: FRAME_TYPE,
      x,
      y,
      props: { rootId: root.id, w, h },
      isLocked: !!root.design?.locked,
    } as unknown as CreatePartial);
    i += 1;
  }
  store.seedFramePositions(seeded);
}

/** Frame records derive from document roots, so reconciliation must never
 *  become an independent tldraw undo entry. */
function syncShapes(editor: Editor) {
  editor.run(
    () => createMissingShapes(editor, useDocumentStore.getState().roots),
    { history: "ignore", ignoreShapeLock: true },
  );
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

function nextScreenName(roots: Iterable<Node>) {
  const taken = new Set(
    Array.from(roots, (root) => root.design?.name).filter((name): name is string => !!name),
  );
  let index = 1;
  while (taken.has(`Screen ${index}`)) index += 1;
  return `Screen ${index}`;
}

function FlowWorkspace({
  roots,
  flows,
  repoFlows,
  activeFlow,
  entryRootId,
  routeIds,
  onSelectScreen,
  onOpenRepoScreen,
  onAddFrame,
  onRenameFlow,
}: {
  roots: Node[];
  flows: FlowDefinition[];
  repoFlows: RepoFlowPanelItem[];
  activeFlow: FlowId;
  entryRootId?: NodeId;
  routeIds?: NodeId[];
  onSelectScreen: (rootId: NodeId) => void;
  onOpenRepoScreen: (screen: RepoPanelScreen) => void;
  onAddFrame: () => void;
  onRenameFlow: (flowId: FlowId, label: string) => boolean;
}) {
  const screens = roots.filter(
    (root) =>
      !useDocumentStore.getState().editingComponentId ||
      root.id !== useDocumentStore.getState().editingComponentId,
  );
  const routeScreens = flowRouteScreens(screens, activeFlow, routeIds);
  const entryScreen =
    (entryRootId ? routeScreens.find((root) => root.id === entryRootId) : undefined) ??
    routeScreens[0];
  const screenLabels = new Map(
    screens.map((root, index) => [root.id, flowScreenName(root, index)]),
  );
  const labelFor = (root: Node, fallbackIndex: number) =>
    screenLabels.get(root.id) ?? flowScreenName(root, fallbackIndex);
  const entryLabel = entryScreen ? labelFor(entryScreen, 0) : null;
  const flowViewportRef = useRef<HTMLDivElement | null>(null);
  const repoFlow = repoFlows.find((flow) => flow.id === activeFlow);
  const activeFlowDefinition = flows.find((flow) => flow.id === activeFlow);
  const activeFlowLabel = activeFlowDefinition?.label ?? flowLabel(flows, activeFlow);
  const [flowNameDraft, setFlowNameDraft] = useState(activeFlowLabel);
  const skipNextFlowNameCommitRef = useRef(false);

  useEffect(() => {
    if (flowViewportRef.current) flowViewportRef.current.scrollLeft = 0;
  }, [activeFlow, entryRootId, routeIds]);

  useEffect(() => {
    setFlowNameDraft(activeFlowLabel);
  }, [activeFlow, activeFlowLabel]);

  const resetFlowNameDraft = () => setFlowNameDraft(activeFlowLabel);

  const commitFlowNameDraft = () => {
    if (skipNextFlowNameCommitRef.current) {
      skipNextFlowNameCommitRef.current = false;
      return;
    }
    const nextLabel = flowNameDraft.trim();
    if (!nextLabel || nextLabel === activeFlowLabel) {
      resetFlowNameDraft();
      return;
    }
    if (!onRenameFlow(activeFlow, nextLabel)) resetFlowNameDraft();
  };

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
              Start <span className="font-medium text-ink">{displayScreenName(entry)}</span>
            </div>
          )}
        </div>
        <div ref={flowViewportRef} className="relative flex-1 overflow-auto">
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
                        Start
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
        </div>
      </div>
    );
  }

  return (
    <div className="studio-chrome flex h-full flex-col bg-canvas">
      <div className="flex items-center gap-sm border-b border-line bg-chrome px-lg py-sm">
        <div className="flex min-w-0 flex-col">
          <TextField
            aria-label="Flow name"
            value={flowNameDraft}
            onChange={setFlowNameDraft}
            onBlur={commitFlowNameDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                skipNextFlowNameCommitRef.current = true;
                resetFlowNameDraft();
                event.currentTarget.blur();
              }
            }}
            className="h-7 max-w-64 border-transparent bg-transparent px-2xs text-sm font-semibold text-ink shadow-none hover:border-line hover:bg-raised focus-visible:border-accent-line focus-visible:bg-chrome-2"
          />
          <span className="text-xs text-ink-faint">{flowDescription(flows, activeFlow)}</span>
        </div>
        {entryScreen && (
          <div className="ml-lg rounded-pill bg-raised px-sm py-1 text-xs text-ink-dim">
            Start <span className="font-medium text-ink">{entryLabel}</span>
          </div>
        )}
        <div className="rounded-pill bg-raised px-sm py-1 text-xs text-ink-dim">
          Routes <span className="font-medium tabular-nums text-ink">{routeScreens.length}</span>
        </div>
        <div className="ml-auto flex items-center gap-xs">
          <IconButton title="Add screen" onClick={onAddFrame}>
            <PlusIcon />
          </IconButton>
        </div>
      </div>
      <div ref={flowViewportRef} className="relative min-h-0 flex-1 overflow-hidden">
        {activeFlowDefinition ? (
          <FlowCanvas
            flow={activeFlowDefinition}
            routeScreens={routeScreens}
            onSelectScreen={onSelectScreen}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-faint">
            Select a flow to map screens.
          </div>
        )}
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
          <Trash2 size={14} aria-hidden="true" />
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

function TopBar({
  workspaceContext,
  onOpenRepoSettings,
  onOpenCodePanel,
}: {
  workspaceContext: string;
  onOpenRepoSettings: () => void;
  onOpenCodePanel: () => void;
}) {
  const gitStatus = useWorkspaceStore((s) => s.gitStatus);
  const syncState = useWorkspaceStore((s) => s.syncState);
  const repoContext = useWorkspaceStore((s) => s.repoContext);
  const codegenBusy = useWorkspaceStore((s) => s.codegenBusy);
  const requestCodegen = useWorkspaceStore((s) => s.requestCodegen);
  const setStatus = useWorkspaceStore((s) => s.setStatus);
  const canUndo = useDocumentStore((s) => s.past.length > 0);
  const canRedo = useDocumentStore((s) => s.future.length > 0);
  const hasActiveInteraction = useDocumentStore((s) => !!s.interaction);
  const hasFocusedRoot = useDocumentStore(
    (s) => !!findRootContaining(Object.values(s.roots), s.selection[0] ?? ""),
  );

  // The document store is the single undo history — frame moves live there too
  // (framePositions), so tldraw's own history never surfaces in the UI.
  const undoAvailable = canUndo || hasActiveInteraction;
  const redoAvailable = canRedo;
  const undoLatest = () => {
    const store = useDocumentStore.getState();
    if (store.interaction) store.commitInteraction();
    if (useDocumentStore.getState().canUndo()) store.undo();
  };
  const redoLatest = () => {
    const store = useDocumentStore.getState();
    if (store.canRedo()) store.redo();
  };

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
    <header
      className="studio-chrome flex items-center gap-md border-b border-line bg-chrome px-xl"
      style={{
        flex: `0 0 ${layout.topbar}px`,
        height: layout.topbar,
      }}
    >
      <div className="flex min-w-0 items-center gap-xs">
        <strong
          className="min-w-0 truncate text-base font-semibold text-ink"
          title={repoContext?.repoPath ? `${repoSubtitle} · ${repoContext.repoPath}` : repoSubtitle}
        >
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
          onClick={onOpenRepoSettings}
        >
          <FolderOpen size={14} aria-hidden="true" />
        </IconButton>
      </div>
      <span className="h-4 w-px shrink-0 bg-line-soft" aria-hidden="true" />
      <span className="min-w-0 truncate text-xs text-ink-faint" title={workspaceContext}>
        {workspaceContext}
      </span>
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
        <IconButton disabled={!undoAvailable} onClick={undoLatest} title="Undo" kbd="⌘Z">
          <Undo2 size={16} aria-hidden="true" />
        </IconButton>
        <IconButton disabled={!redoAvailable} onClick={redoLatest} title="Redo" kbd="⌘⇧Z">
          <Redo2 size={16} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="flex min-w-0 items-center gap-sm border-l border-line-soft pl-md">
        <IconButton
          title="Preview generated code"
          onClick={() => {
            onOpenCodePanel();
            setStatus("Previewing generated code");
            void requestCodegen("preview");
          }}
          disabled={codegenBusy || !hasFocusedRoot}
        >
          <Play size={14} aria-hidden="true" />
        </IconButton>
        <Button
          variant="primary"
          disabled={codegenBusy || !hasFocusedRoot}
          title="Sync generated files"
          onClick={() => void requestCodegen("sync")}
        >
          <Save size={14} aria-hidden="true" /> Sync
        </Button>
      </div>
    </header>
  );
}

/** The one-line status readout. Its own subscriber so the near-constant status
 *  churn (every tool action sets it) never re-renders the shell. */
function StatusStrip() {
  const status = useWorkspaceStore((s) => s.status);
  return (
    <div className="studio-chrome flex h-7 flex-none items-center gap-sm border-t border-line bg-chrome px-md text-xs text-ink-dim">
      <span className="truncate">{status}</span>
    </div>
  );
}

/** Persistent error notices. Confirmations stay in the status strip; failures
 *  stack here until dismissed so they can't scroll past unseen. */
function Toasts() {
  const toasts = useWorkspaceStore((s) => s.toasts);
  const dismiss = useWorkspaceStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="studio-chrome fixed bottom-10 right-4 z-50 flex w-80 flex-col gap-xs">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className="flex items-start gap-sm rounded-sm border border-amber/50 bg-chrome p-sm shadow-popover"
        >
          <AlertTriangle size={14} aria-hidden="true" className="mt-px shrink-0 text-amber" />
          <div className="min-w-0 flex-1 break-words text-xs text-ink">{toast.message}</div>
          <button
            type="button"
            title="Dismiss"
            onClick={() => dismiss(toast.id)}
            className="shrink-0 text-ink-faint transition-colors hover:text-ink"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

const RIGHT_COLUMN_WIDTH_KEY = "rn-canvas.rightColumnWidth";
const RIGHT_COLUMN_MIN = 300;
const RIGHT_COLUMN_MAX = 640;

function readStoredRightColumnWidth(): number {
  try {
    const raw = Number(window.localStorage.getItem(RIGHT_COLUMN_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= RIGHT_COLUMN_MIN && raw <= RIGHT_COLUMN_MAX) return raw;
  } catch {
    /* storage unavailable */
  }
  return layout.rightColumn;
}

function ChangesTimeline({ onOpenCode }: { onOpenCode: () => void }) {
  const gitStatus = useWorkspaceStore((s) => s.gitStatus);
  const repoPath = useWorkspaceStore((s) => s.repoPath);
  const repoContext = useWorkspaceStore((s) => s.repoContext);
  const onRefresh = useWorkspaceStore((s) => s.refreshGitStatus);
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
  const pendingFocusRootIdRef = useRef<NodeId | null>(null);
  const pendingFlowManifestRef = useRef<FlowManifest | null>(null);

  const [inspectorTab, setInspectorTab] = useState("Design");
  const [workspace, setWorkspace] = useState<WorkspaceMode>("Screen");
  const [activeFlow, setActiveFlow] = useState<FlowId>("onboarding");
  const [pendingRemoveFlowId, setPendingRemoveFlowId] = useState<FlowId | null>(null);
  const [activeDesignSystemView, setActiveDesignSystemView] =
    useState<DesignSystemView>("Tokens");
  const [rightColumnWidth, setRightColumnWidth] = useState(readStoredRightColumnWidth);

  // Workspace slices App itself renders or orchestrates. Panels that own their
  // display state (CodePanel, ChangesTimeline, TopBar, StatusStrip) subscribe
  // to the workspace store directly — status/sync/codegen churn stays out of
  // the shell render.
  const gitStatus = useWorkspaceStore((s) => s.gitStatus);
  const repoContext = useWorkspaceStore((s) => s.repoContext);
  const sidecarPath = useWorkspaceStore((s) => s.sidecarPath);
  const activeRepoScreen = useWorkspaceStore((s) => s.activeRepoScreen);
  const loadedRepoScreens = useWorkspaceStore((s) => s.loadedRepoScreens);
  const flowsById = useWorkspaceStore((s) => s.flowsById);
  const flowOrder = useWorkspaceStore((s) => s.flowOrder);
  const setStatus = useWorkspaceStore((s) => s.setStatus);
  const setActiveRepoScreen = useWorkspaceStore((s) => s.setActiveRepoScreen);
  const refreshGitStatus = useWorkspaceStore((s) => s.refreshGitStatus);
  const loadRepo = useWorkspaceStore((s) => s.loadRepo);
  const loadCanvasManifest = useWorkspaceStore((s) => s.loadCanvasManifest);
  const applyFlowManifestToStore = useWorkspaceStore((s) => s.applyFlowManifest);
  const updateStoredFlowRoutes = useWorkspaceStore((s) => s.updateFlowRoutes);
  const upsertStoredFlow = useWorkspaceStore((s) => s.upsertFlow);
  const removeStoredFlow = useWorkspaceStore((s) => s.removeFlow);
  const openSidecar = useWorkspaceStore((s) => s.openSidecar);
  const importSource = useWorkspaceStore((s) => s.importSource);
  const requestCodegen = useWorkspaceStore((s) => s.requestCodegen);

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
  const flows = useMemo(
    () => flowOrder.flatMap((id) => (flowsById[id] ? [flowsById[id]] : [])),
    [flowOrder, flowsById],
  );
  const flowPanelItems = useMemo<FlowPanelItem[]>(() => {
    const screenRoots = Object.values(roots).filter((root) => root.id !== editingComponentId);
    return flows.map((flow) => ({
      id: flow.id,
      label: flow.label,
      screenCount: flowRouteScreens(screenRoots, flow.id, flow.routes).length,
    }));
  }, [editingComponentId, flows, roots]);
  const repoFlowItems = useMemo(
    () => repoFlowItemsForContext(repoContext),
    [repoContext],
  );
  if (focusedRootId && focusedRootId !== editingComponentId) {
    setSyncRootHint(focusedRootId);
  }

  useEffect(() => {
    if (!activeRepoScreen || roots[activeRepoScreen.rootId]) return;
    setActiveRepoScreen(null);
  }, [activeRepoScreen, roots, setActiveRepoScreen]);

  // Canvas-side effects for repo document opens: focus the new frame and clear
  // tldraw's (inert) history.
  useEffect(() => {
    registerStudioHooks({
      onRepoDocumentOpened: (rootId) => {
        pendingFocusRootIdRef.current = rootId;
        editorRef.current?.clearHistory();
      },
    });
    return initWorkspaceSubscriptions();
  }, []);

  const canUndo = useDocumentStore((s) => s.past.length > 0);
  const canRedo = useDocumentStore((s) => s.future.length > 0);
  const hasActiveInteraction = useDocumentStore((s) => !!s.interaction);
  const undo = useDocumentStore((s) => s.undo);
  const redo = useDocumentStore((s) => s.redo);

  useEffect(() => startMcpBridge(handleMcpCommand), []);

  useEffect(() => {
    if (inspectorTab === "Props") setInspectorTab("Design");
  }, [inspectorTab]);

  useEffect(() => {
    if (flows.length === 0) return;
    const hasManualFlow = flows.some((flow) => flow.id === activeFlow);
    const hasRepoFlow = repoFlowItems.some((flow) => flow.id === activeFlow);
    if (!hasManualFlow && !hasRepoFlow) {
      setActiveFlow(flows[0].id as FlowId);
    }
  }, [activeFlow, flows, repoFlowItems]);

  const applyFlowManifest = useCallback((body: FlowManifest) => {
    const state = useDocumentStore.getState();
    const screenRoots = Object.values(state.roots).filter(
      (root) => root.id !== state.editingComponentId,
    );
    const hasRoutes = body.flows.some(
      (flow) => Array.isArray(flow.routes) && flow.routes.length > 0,
    );
    if (hasRoutes && screenRoots.length === 0) {
      pendingFlowManifestRef.current = body;
      return;
    }
    pendingFlowManifestRef.current = null;
    applyFlowManifestToStore(body);
    const firstFlowId = body.flows[0]?.id;
    if (firstFlowId) {
      setActiveFlow((current) =>
        body.flows.some((flow) => flow.id === current) ? current : (firstFlowId as FlowId),
      );
    }
  }, [applyFlowManifestToStore]);

  useEffect(() => {
    if (!pendingFlowManifestRef.current) return;
    const screenRoots = Object.values(roots).filter((root) => root.id !== editingComponentId);
    if (screenRoots.length === 0) return;
    applyFlowManifest(pendingFlowManifestRef.current);
  }, [applyFlowManifest, editingComponentId, roots]);

  const loadFlowManifest = useCallback(async () => {
    try {
      const res = await fetch("/api/flows");
      const body = (await res.json()) as FlowManifest & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      applyFlowManifest(body);
    } catch {
      // A missing flow manifest is fine; flows start from inferred screen order.
    }
  }, [applyFlowManifest]);

  useEffect(() => {
    void loadRepo();
    void refreshGitStatus();
    void loadFlowManifest();
    void loadCanvasManifest();
    // Poll git only while the tab is visible; refresh once on return so a
    // backgrounded Studio doesn't spawn a git subprocess every 5s.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshGitStatus();
    }, 5_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshGitStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadCanvasManifest, loadFlowManifest, loadRepo, refreshGitStatus]);

  const onMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
    // Keep tldraw's own canvas affordances light and gridded by default.
    editor.user.updateUserPreferences({ colorScheme: "light" });
    editor.updateInstanceState({ isGridMode: true });

    const store = useDocumentStore.getState();
    if (Object.keys(store.roots).length === 0) {
      const seed = createScreenFrame(
        [createNode("Text", { props: { text: "Hello RN Canvas" } })],
        nextScreenName(Object.values(store.roots)),
      );
      workspaceFlags.skipTokenWrite = true; // seed load — don't write theme.ts
      workspaceFlags.skipCodeSync = true; // seed load — don't write generated files
      useWorkspaceStore.getState().setActiveRepoScreen(null);
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

  }, []);

  // The document store is the single undo history — frame moves live there too
  // (framePositions), so tldraw's own history never surfaces in the UI.
  const undoAvailable = canUndo || hasActiveInteraction;
  const redoAvailable = canRedo;

  const undoLatest = useCallback(() => {
    const store = useDocumentStore.getState();
    if (store.interaction) store.commitInteraction();
    if (useDocumentStore.getState().canUndo()) undo();
  }, [undo]);

  const redoLatest = useCallback(() => {
    if (useDocumentStore.getState().canRedo()) redo();
  }, [redo]);

  const resetCanvasHistory = useCallback(() => {
    // tldraw history is inert (never user-facing); clear it on document loads so
    // it can't accumulate across sessions.
    editorRef.current?.clearHistory();
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
    setInspectorTab("Design");
    setStatus("Opened screen");
  }, []);

  const openChangesPanel = useCallback(() => {
    setInspectorTab("History");
    setStatus("Showing changes");
  }, []);

  const updateFlowRoutes = useCallback(
    (
      updater: (current: NodeId[] | undefined, screens: Node[]) => NodeId[],
      status: string,
    ) => {
      const screenRoots = Object.values(roots).filter((root) => root.id !== editingComponentId);
      const current = flowsById[activeFlow]?.routes;
      const nextRouteIds = updater(current, screenRoots);
      void updateStoredFlowRoutes(activeFlow, nextRouteIds, screenRoots).then(
        () => setStatus(status),
        (error) => setStatus(error instanceof Error ? error.message : "Flow manifest save failed"),
      );
    },
    [activeFlow, editingComponentId, flowsById, roots, updateStoredFlowRoutes],
  );

  const addScreenToFlow = useCallback(
    (rootId: NodeId) => {
      updateFlowRoutes(
        (current, screenRoots) => addFlowRoute(screenRoots, activeFlow, current, rootId),
        "Added screen to flow",
      );
    },
    [activeFlow, updateFlowRoutes],
  );

  const removeScreenFromFlow = useCallback(
    (rootId: NodeId) => {
      updateFlowRoutes(
        (current, screenRoots) => removeFlowRoute(screenRoots, activeFlow, current, rootId),
        "Removed screen from flow",
      );
    },
    [activeFlow, updateFlowRoutes],
  );

  const moveScreenInFlow = useCallback(
    (rootId: NodeId, offset: -1 | 1) => {
      updateFlowRoutes(
        (current, screenRoots) => reorderFlowRoute(screenRoots, activeFlow, current, rootId, offset),
        "Updated flow order",
      );
    },
    [activeFlow, updateFlowRoutes],
  );

  const addFlow = useCallback(() => {
    const labelBase = "New Flow";
    const takenLabels = new Set(flows.map((flow) => flow.label));
    let label = labelBase;
    for (let i = 2; takenLabels.has(label); i += 1) label = `${labelBase} ${i}`;
    const nextFlow: FlowDefinition = {
      id: slugFlowId(label, new Set(flows.map((flow) => flow.id))),
      label,
      description: "Prototype route order for this screen group.",
      routes: [],
      edges: [],
    };
    void upsertStoredFlow(nextFlow).then(
      () => setStatus(`Added ${label}`),
      (error) => setStatus(error instanceof Error ? error.message : "Flow manifest save failed"),
    );
    setActiveFlow(nextFlow.id as FlowId);
    setPendingRemoveFlowId(null);
    setWorkspace("Flow");
  }, [flows, upsertStoredFlow]);

  const renameFlow = useCallback(
    (flowId: FlowId, label: string) => {
      const nextLabel = label.trim();
      if (!nextLabel) {
        setStatus("Flow name required");
        return false;
      }
      const currentFlow = flows.find((flow) => flow.id === flowId);
      if (!currentFlow || currentFlow.label === nextLabel) return false;
      const duplicate = flows.some(
        (flow) => flow.id !== flowId && flow.label.toLowerCase() === nextLabel.toLowerCase(),
      );
      if (duplicate) {
        setStatus("Flow name already exists");
        return false;
      }
      void upsertStoredFlow({ ...currentFlow, label: nextLabel }).then(
        () => setStatus(`Renamed flow to ${nextLabel}`),
        (error) => setStatus(error instanceof Error ? error.message : "Flow manifest save failed"),
      );
      return true;
    },
    [flows, upsertStoredFlow],
  );

  const updateFlowDefinition = useCallback(
    (flow: FlowDefinition, status: string) => {
      void upsertStoredFlow(flow).then(
        () => setStatus(status),
        (error) => setStatus(error instanceof Error ? error.message : "Flow manifest save failed"),
      );
    },
    [setStatus, upsertStoredFlow],
  );

  const removeFlow = useCallback(
    (flow: FlowPanelItem) => {
      if (flows.length <= 1) {
        setStatus("Keep at least one flow.");
        return;
      }
      const screenRoots = Object.values(roots).filter((root) => root.id !== editingComponentId);
      const screenCount =
        flow.screenCount ?? flowRouteScreens(screenRoots, flow.id, flowsById[flow.id]?.routes).length;
      if (screenCount > 1 && pendingRemoveFlowId !== flow.id) {
        setPendingRemoveFlowId(flow.id);
        setStatus(`Confirm removal of ${flow.label}`);
        return;
      }
      const nextFlows = flows.filter((item) => item.id !== flow.id);
      const nextActiveFlow = activeFlow === flow.id ? nextFlows[0]?.id : activeFlow;
      if (!nextActiveFlow) {
        setStatus("Keep at least one flow.");
        return;
      }
      setPendingRemoveFlowId(null);
      setActiveFlow(nextActiveFlow as FlowId);
      void removeStoredFlow(flow.id).then(
        () => setStatus(`Removed ${flow.label}`),
        (error) => setStatus(error instanceof Error ? error.message : "Flow manifest save failed"),
      );
    },
    [
      activeFlow,
      editingComponentId,
      flowsById,
      flows,
      pendingRemoveFlowId,
      removeStoredFlow,
      roots,
    ],
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

      // Single-key tool shortcuts (Figma/Paper-style, no modifier). V/H/Z switch
      // host tools; F creates a screen; R/T/I arm primitives for the next drag.
      // Esc clears an armed tool or walks up layer selection.
      if (!modifier && !event.altKey && !event.shiftKey && event.key.length === 1) {
        const studio = useStudioStore.getState();
        const k = event.key.toLowerCase();
        if (k === "v") {
          event.preventDefault();
          studio.setCanvasTool("select");
          editorRef.current?.setCurrentTool("select");
          setStatus("Select tool");
          return;
        }
        if (k === "h") {
          event.preventDefault();
          studio.setCanvasTool("hand");
          editorRef.current?.setCurrentTool("hand");
          setStatus("Hand tool");
          return;
        }
        if (k === "z") {
          event.preventDefault();
          studio.setCanvasTool("zoom");
          editorRef.current?.setCurrentTool("zoom");
          setStatus("Zoom tool");
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
        const focused = findRootContaining(Object.values(store.roots), store.selection[0] ?? "");
        const currentId = store.selection[0];
        if (focused && currentId) {
          const next = parentLayerSelection(focused, currentId);
          if (next !== currentId) {
            event.preventDefault();
            event.stopImmediatePropagation();
            store.setSelection([next]);
            const node = findNode(focused, next);
            setStatus(`Selected ${node?.design?.name ?? node?.type ?? "parent layer"}`);
          }
        }
        return;
      }

      if (!modifier && !event.altKey && event.key === "Tab") {
        const rootsList = Object.values(store.roots);
        const focused = findRootContaining(rootsList, store.selection[0] ?? "") ?? rootsList[0];
        if (focused) {
          const currentId = store.selection[store.selection.length - 1];
          const next = nextLayerSelection(focused, currentId, event.shiftKey ? -1 : 1, {
            includeRoot: true,
          });
          if (next) {
            event.preventDefault();
            event.stopImmediatePropagation();
            store.setSelection([next]);
            const node = findNode(focused, next);
            setStatus(`Selected ${node?.design?.name ?? node?.type ?? "layer"}`);
          }
        }
        return;
      }

      if (!modifier && !event.altKey && !event.shiftKey && event.key === "Enter") {
        const focused = findRootContaining(Object.values(store.roots), store.selection[0] ?? "");
        const currentId = store.selection[0];
        const next = focused && currentId ? firstSelectableChild(focused, currentId) : undefined;
        if (focused && next) {
          event.preventDefault();
          event.stopImmediatePropagation();
          store.setSelection([next]);
          const node = findNode(focused, next);
          setStatus(`Selected ${node?.design?.name ?? node?.type ?? "child layer"}`);
        }
        return;
      }

      if (modifier && event.key.toLowerCase() === "z") {
        // Always intercept: the document store owns the only undo history, and
        // letting tldraw's shortcut fire would replay its (inert) shape records
        // against store-owned frame positions.
        event.preventDefault();
        event.stopImmediatePropagation();
        const redoRequested = event.shiftKey;
        if (store.interaction) store.commitInteraction();
        const live = useDocumentStore.getState();
        if (redoRequested ? live.canRedo() : live.canUndo()) {
          if (redoRequested) live.redo();
          else live.undo();
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
      // Absolute children keep the positional model: arrows nudge 1px (Shift 10px).
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        const focused = findRootContaining(Object.values(store.roots), store.selection[0] ?? "");
        const nodeIds = focused
          ? normalizeNodeSelection(focused, store.selection, { excludeRoot: true })
          : [];
        const absoluteIds = focused
          ? nodeIds.filter((id) => {
              const candidate = findNode(focused, id);
              return candidate?.style.position === "absolute" && !candidate.design?.locked;
            })
          : [];
        if (focused && absoluteIds.length > 0) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const step = event.shiftKey ? 10 : 1;
          const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
          const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
          const snapshot = useStudioStore.getState().layouts[focused.id]?.snapshot;
          store.beginInteraction();
          try {
            for (const id of absoluteIds) {
              const node = findNode(focused, id);
              if (!node) continue;
              // Backfill unset start pins from the last layout so a nudge moves
              // from the rendered position instead of jumping toward 0 (same
              // backfill the canvas group drag does in LayerOverlay).
              const style = { ...node.style };
              const box = snapshot?.get(id)?.[0];
              const parent = getParent(focused, id);
              const parentBox = parent ? snapshot?.get(parent.id)?.[0] : undefined;
              if (box && parentBox) {
                const borderLeft =
                  parent?.style.borderLeftWidth ?? parent?.style.borderWidth ?? 0;
                const borderTop =
                  parent?.style.borderTopWidth ?? parent?.style.borderWidth ?? 0;
                if (
                  absoluteConstraintMode(style, "horizontal") === "start" &&
                  style.left === undefined
                ) {
                  style.left = box.left - parentBox.left - borderLeft;
                }
                if (
                  absoluteConstraintMode(style, "vertical") === "start" &&
                  style.top === undefined
                ) {
                  style.top = box.top - parentBox.top - borderTop;
                }
              }
              useDocumentStore.getState().updateStyle(focused.id, id, {
                ...(dx !== 0 ? absoluteMovePatch(style, "horizontal", dx) : {}),
                ...(dy !== 0 ? absoluteMovePatch(style, "vertical", dy) : {}),
              });
            }
            useDocumentStore.getState().commitInteraction();
          } catch {
            useDocumentStore.getState().cancelInteraction();
          }
          setStatus(
            `Nudged ${absoluteIds.length} layer${absoluteIds.length === 1 ? "" : "s"}`,
          );
          return;
        }
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

  // Mirror store-owned frame positions → shapes (undo/redo, canvas.json load).
  // An imperative subscription, not an effect on framePositions: live drags
  // write positions per pointermove and must not re-render the whole shell.
  // During a drag tldraw has already moved the shape, so the equality guard
  // makes this a no-op until an undo/redo or external load changes positions.
  useEffect(() => {
    let last = useDocumentStore.getState().framePositions;
    const unsubscribe = useDocumentStore.subscribe((state) => {
      if (state.framePositions === last) return;
      last = state.framePositions;
      const editor = editorRef.current;
      if (!editor) return;
      reconcilingShapesRef.current = true;
      try {
        editor.run(
          () => {
            for (const shape of editor.getCurrentPageShapes()) {
              if (!isFrame(shape)) continue;
              const position = state.framePositions[asFrame(shape).props.rootId];
              if (!position) continue;
              if (
                Math.abs(shape.x - position.x) > 0.01 ||
                Math.abs(shape.y - position.y) > 0.01
              ) {
                editor.updateShape({
                  id: shape.id,
                  type: FRAME_TYPE,
                  x: position.x,
                  y: position.y,
                } as unknown as UpdatePartial);
              }
            }
          },
          { history: "ignore", ignoreShapeLock: true },
        );
      } finally {
        reconcilingShapesRef.current = false;
      }
    });
    return unsubscribe;
  }, []);

  const addFrame = useCallback(() => {
    const store = useDocumentStore.getState();
    const root = createScreenFrame([], nextScreenName(Object.values(store.roots)));
    pendingFocusRootIdRef.current = root.id;
    setActiveRepoScreen(null);
    store.addRoot(root);
    store.setSelection([root.id]);
    return root;
  }, []);

  const addFrameToActiveFlow = useCallback(() => {
    const root = addFrame();
    const screenRoots = Object.values(useDocumentStore.getState().roots).filter(
      (item) => item.id !== useDocumentStore.getState().editingComponentId,
    );
    const current = flowsById[activeFlow]?.routes;
    const nextRoutes = addFlowRoute(screenRoots, activeFlow, current, root.id);
    void updateStoredFlowRoutes(activeFlow, nextRoutes, screenRoots).then(
      () => setStatus("Added screen to flow"),
      (error) => setStatus(error instanceof Error ? error.message : "Flow manifest save failed"),
    );
  }, [activeFlow, addFrame, flowsById, updateStoredFlowRoutes]);

  const setCanvasTool = useCallback((tool: CanvasTool) => {
    useStudioStore.getState().setCanvasTool(tool);
    editorRef.current?.setCurrentTool(tool);
    const label = tool.charAt(0).toUpperCase() + tool.slice(1);
    setStatus(`${label} tool active`);
  }, []);


  const openRepoSettings = useCallback(() => {
    setInspectorTab("Code");
    setStatus("Repository settings");
  }, []);

  const openRepoScreen = useCallback(
    (screen: NonNullable<RepoContext>["screens"][number]) => {
      setWorkspace("Screen");
      if (screen.sidecarPath) {
        void openSidecar(screen.sidecarPath, "merge");
        return;
      }
      void importSource(screen.path, "merge");
    },
    [importSource, openSidecar],
  );



  // Read-only context crumb mirroring the active workspace (and its object where known).
  const activeFlowDefinition = flowsById[activeFlow];
  const flowInspectorScreens = Object.values(roots).filter((root) => root.id !== editingComponentId);
  const flowInspectorRouteScreens = activeFlowDefinition
    ? flowRouteScreens(flowInspectorScreens, activeFlow, activeFlowDefinition.routes)
    : [];
  const flowInspectorAvailableScreens = activeFlowDefinition
    ? flowAvailableScreens(flowInspectorScreens, activeFlow, activeFlowDefinition.routes)
    : [];
  const workspaceContext =
    workspace === "Component"
      ? `Component · ${editingComponentName ?? "Untitled"}`
      : workspace === "Flow"
        ? `Flow · ${flowPanelItems.find((flow) => flow.id === activeFlow)?.label ?? "Untitled"}`
        : workspace === "Design System"
          ? "Design System"
          : "Screen";

  return (
    <TooltipProvider>
    <div
      style={{
        height: "100vh",
        minWidth: layout.workspaceMin,
        display: "flex",
        flexDirection: "column",
        background: color.canvas,
      }}
    >
      {/* TOP BAR (self-subscribing: git/sync pills don't re-render the shell) */}
      <TopBar workspaceContext={workspaceContext} onOpenRepoSettings={openRepoSettings} onOpenCodePanel={() => setInspectorTab("Code")} />

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
          onFocusCanvasScreen={() => setActiveRepoScreen(null)}
          gitStatus={gitStatus}
          sidecarPath={sidecarPath}
          activeRepoScreen={activeRepoScreen}
          loadedRepoScreens={loadedRepoScreens}
          repoContext={repoContext}
        />

        <div className="relative flex min-w-0 flex-1 flex-col">
          {workspace === "Flow" ? (
            <FlowWorkspace
              roots={Object.values(roots)}
              flows={flows}
              repoFlows={repoFlowItems}
              activeFlow={activeFlow}
              entryRootId={activeFlowDefinition?.entryRootId}
              routeIds={activeFlowDefinition?.routes}
              onSelectScreen={selectScreenFromWorkspace}
              onOpenRepoScreen={openRepoScreen}
              onAddFrame={addFrameToActiveFlow}
              onRenameFlow={renameFlow}
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
                onCanvasTool={setCanvasTool}
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
            </>
          )}
          {/* Shared status strip — consistent across all workspaces so the canvas
              frame keeps a stable height as the workspace changes. */}
          <StatusStrip />
        </div>

        {/* RIGHT COLUMN: canvas/code inspector. Drag the divider to resize —
            diffs want width. Width persists per browser. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize inspector"
          title="Drag to resize"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const width = Math.min(
              RIGHT_COLUMN_MAX,
              Math.max(RIGHT_COLUMN_MIN, window.innerWidth - event.clientX),
            );
            setRightColumnWidth(width);
            try {
              window.localStorage.setItem(RIGHT_COLUMN_WIDTH_KEY, String(width));
            } catch {
              /* storage unavailable */
            }
          }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
          className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent-line"
        />
        <div
          className="studio-chrome"
          style={{
            flex: `0 0 ${rightColumnWidth}px`,
            width: rightColumnWidth,
            borderLeft: `1px solid ${color.line}`,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {workspace === "Flow" ? (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ padding: space.md, paddingBottom: 0 }}>
                <div className="mb-xs flex items-center gap-xs">
                  <div className="eyebrow min-w-0 flex-1 truncate">Flow Inspector</div>
                </div>
              </div>
              <FlowInspector
                flow={activeFlowDefinition}
                screens={flowInspectorScreens}
                routeScreens={flowInspectorRouteScreens}
                availableScreens={flowInspectorAvailableScreens}
                onSelectScreen={selectScreenFromWorkspace}
                onAddRoute={addScreenToFlow}
                onRemoveRoute={removeScreenFromFlow}
                onMoveRoute={moveScreenInFlow}
                onUpdateFlow={updateFlowDefinition}
              />
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ padding: space.md, paddingBottom: 0 }}>
                <div className="mb-xs flex items-center gap-xs">
                  <div className="eyebrow min-w-0 flex-1 truncate">Inspector</div>
                  {inspectorTab !== "Design" && (
                    <span className="text-2xs font-semibold text-ink-faint">
                      {inspectorTab}
                    </span>
                  )}
                </div>
                {/* Interact (interactions/navigation) is phase 3 — not shown in v1. */}
                <Tabs
                  tabs={["Design", "Code", "History"]}
                  active={inspectorTab}
                  onSelect={setInspectorTab}
                  variant="underline"
                />
              </div>
              <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                {inspectorTab === "Design" ? (
                  <ErrorBoundary label="Inspector" resetKey={selection[0] ?? null}>
                    <Inspector rootId={focusedRootId} />
                  </ErrorBoundary>
                ) : inspectorTab === "Code" ? (
                  <CodePanel />
                ) : (
                  <ChangesTimeline onOpenCode={() => setInspectorTab("Code")} />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <LayerContextMenu />
      <Toasts />
    </div>
    </TooltipProvider>
  );
}
