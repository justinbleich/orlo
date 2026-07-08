import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  FileCode2,
  FileJson2,
  FolderOpen,
  GitCommitHorizontal,
  Play,
  RefreshCw,
  Redo2,
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
  RN_PRIMITIVES,
  resolveVariant,
  useDocumentStore,
  type ComponentDefinition,
  type DesignToken,
  type Node,
  type NodeId,
  type RNPrimitive,
  type TokenCategory,
} from "@rn-canvas/document";
import { FrameShapeUtil, type FrameShape } from "./shapes/FrameShape";
import { VariantPreviewShapeUtil, type VariantPreviewShape } from "./shapes/VariantPreviewShape";
import { ComponentWorkspace, type ComponentWorkspaceTab } from "./ComponentWorkspace";
import { FlowCanvas } from "./FlowCanvas";
import { FlowInspector } from "./FlowInspector";
import { CodePanel } from "./CodePanel";
import { gitFileStatusLabel, type GitFileStatus, type GitStatus } from "./code-artifacts";
import {
  initWorkspaceSubscriptions,
  registerStudioHooks,
  setSyncRootHint,
  useWorkspaceStore,
  type ActiveRepoScreen,
  type FlowDefinition,
} from "./workspace-store";
import { ComponentEditPanel, Inspector } from "./Inspector";
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
  type ScreenFlowBadges,
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
import { toComponentDisplayPath, toComponentFileName } from "./component-name";
import { nextFreeFramePosition } from "./canvas-arrange";
import { absoluteConstraintMode, absoluteMovePatch } from "@rn-canvas/styles";
import { deleteNodes, duplicateNodes, reorderNode } from "./document-actions";
import { startMcpBridge } from "./mcp-bridge";
import {
  applyCreationPreset,
  supportedCreationPresets,
  type CreationPreset,
} from "./component-creation-presets";
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
import {
  MAX_VARIANT_PREVIEWS,
  variantFrameLayout,
  variantPreviewCombinations,
  variantPreviewKey,
} from "./variant-workspace";

const shapeUtils = [FrameShapeUtil, VariantPreviewShapeUtil];
const FRAME_TYPE = FrameShapeUtil.type;
const VARIANT_PREVIEW_TYPE = VariantPreviewShapeUtil.type;

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
const isVariantPreview = (s: EditorShape) => (s.type as string) === VARIANT_PREVIEW_TYPE;
const asVariantPreview = (s: EditorShape) => s as unknown as VariantPreviewShape;
type CreatePartial = Parameters<Editor["createShape"]>[0];
type UpdatePartial = Parameters<Editor["updateShape"]>[0];

type RepoContext = RepoPanelContext;

type WorkspaceMode = "Screen" | "Component" | "Flow" | "Design System";
type CreateComponentDraft = {
  rootId: NodeId;
  nodeId: NodeId;
  nodeLabel: string;
  nodeType: string;
  childCount: number;
  displayPath: string;
  preset: CreationPreset;
};

function rootSize(root: Node): { w: number; h: number } {
  const w = typeof root.style.width === "number" ? root.style.width : 320;
  const h = typeof root.style.height === "number" ? root.style.height : 200;
  return { w, h };
}

function componentDisplayPathFromInput(displayPath: string, fallback: string): string {
  const base = toComponentDisplayPath(displayPath || fallback, fallback);
  return (RN_PRIMITIVES as readonly string[]).includes(base) ? `${base}Component` : base;
}

function uniqueComponentDisplayPath(
  base: string,
  components: Record<string, ComponentDefinition>,
): string {
  const taken = new Set(Object.values(components).map((component) => component.name));
  const takenFiles = new Set(
    Object.values(components).map((component) => toComponentFileName(component.name)),
  );
  const segments = base.split(".");
  const last = segments.at(-1) || "Component";
  let name = base;
  for (let i = 2; taken.has(name) || takenFiles.has(toComponentFileName(name)); i += 1) {
    name = [...segments.slice(0, -1), `${last}${i}`].join(".");
  }
  return name;
}

function childCountFor(node: Node): number {
  return "children" in node && Array.isArray(node.children) ? node.children.length : 0;
}

/** Create a tldraw shape for any document root that doesn't have one yet. */
function createMissingShapes(editor: Editor, roots: Record<NodeId, Node>) {
  const frameShapes = editor.getCurrentPageShapes().filter(isFrame).map(asFrame);
  const existing = new Set(frameShapes.map((shape) => shape.props.rootId));
  const occupied = frameShapes.map((shape) => ({
    x: shape.x,
    y: shape.y,
    width: shape.props.w,
    height: shape.props.h,
  }));
  const store = useDocumentStore.getState();
  const seeded: Record<NodeId, { x: number; y: number }> = {};
  for (const root of Object.values(roots)) {
    if (existing.has(root.id)) continue;
    const { w, h } = rootSize(root);
    // Stored position wins (persisted arrangement / undo state); new frames get
    // the grid slot, recorded back so the layout is durable from the start.
    const stored = store.framePositions[root.id];
    const position =
      stored ??
      nextFreeFramePosition(
        occupied,
        { width: w, height: h },
        56,
        { x: 80, y: 80 },
      );
    const { x, y } = position;
    if (!stored) seeded[root.id] = { x, y };
    editor.createShape({
      id: createShapeId(),
      type: FRAME_TYPE,
      x,
      y,
      props: { rootId: root.id, w, h },
      isLocked: !!root.design?.locked,
    } as unknown as CreatePartial);
    occupied.push({ x, y, width: w, height: h });
  }
  store.seedFramePositions(seeded);
}

function syncVariantPreviewShapes(editor: Editor) {
  const store = useDocumentStore.getState();
  const { editingComponentId, components, roots } = store;
  const existingPreviewShapes = editor.getCurrentPageShapes().filter(isVariantPreview);
  const removeAllPreviews = () => {
    if (existingPreviewShapes.length > 0) {
      editor.deleteShapes(existingPreviewShapes.map((shape) => shape.id));
    }
  };

  if (!editingComponentId) {
    removeAllPreviews();
    return;
  }
  const definition = components[editingComponentId];
  const editingRoot = roots[editingComponentId];
  const axes = definition?.variants?.filter((axis) => axis.values.length > 0) ?? [];
  const baseShape = findFrameShapeForRoot(editor, editingComponentId);
  if (!definition || !editingRoot || axes.length === 0 || !baseShape) {
    removeAllPreviews();
    return;
  }

  const baseFrame = asFrame(baseShape);
  const defaultKey = variantPreviewKey(definition, resolveVariant(definition, {}));
  const combos = variantPreviewCombinations(definition)
    .filter((values) => variantPreviewKey(definition, values) !== defaultKey)
    .slice(0, MAX_VARIANT_PREVIEWS);
  const boxes = variantFrameLayout(
    { x: baseFrame.x, y: baseFrame.y, w: baseFrame.props.w, h: baseFrame.props.h },
    combos,
  );
  const desired = new Map(
    combos.map((values, index) => [
      variantPreviewKey(definition, values),
      { values, box: boxes[index] },
    ]),
  );
  const existing = new Map<string, VariantPreviewShape>();

  for (const shape of existingPreviewShapes) {
    const preview = asVariantPreview(shape);
    const key = variantPreviewKey(definition, preview.props.variantValues);
    if (preview.props.componentId !== editingComponentId || !desired.has(key) || existing.has(key)) {
      editor.deleteShapes([shape.id]);
      continue;
    }
    existing.set(key, preview);
  }

  for (const [key, item] of desired) {
    const current = existing.get(key);
    if (current) {
      const needsUpdate =
        Math.abs(current.x - item.box.x) > 0.01 ||
        Math.abs(current.y - item.box.y) > 0.01 ||
        current.props.w !== item.box.w ||
        current.props.h !== item.box.h ||
        current.props.componentId !== editingComponentId;
      if (needsUpdate) {
        editor.updateShape({
          id: current.id,
          type: VARIANT_PREVIEW_TYPE,
          x: item.box.x,
          y: item.box.y,
          props: {
            componentId: editingComponentId,
            variantValues: item.values,
            w: item.box.w,
            h: item.box.h,
          },
          isLocked: true,
        } as unknown as UpdatePartial);
      }
      continue;
    }
    editor.createShape({
      id: createShapeId(),
      type: VARIANT_PREVIEW_TYPE,
      x: item.box.x,
      y: item.box.y,
      props: {
        componentId: editingComponentId,
        variantValues: item.values,
        w: item.box.w,
        h: item.box.h,
      },
      isLocked: true,
    } as unknown as CreatePartial);
  }
}

/** Frame records derive from document roots, so reconciliation must never
 *  become an independent tldraw undo entry. */
function syncShapes(editor: Editor) {
  editor.run(
    () => {
      createMissingShapes(editor, useDocumentStore.getState().roots);
      syncVariantPreviewShapes(editor);
    },
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

function focusVariantPreviewFrame(
  editor: Editor,
  componentId: NodeId,
  definition: ComponentDefinition,
  values: Record<string, string>,
  animate = true,
) {
  const key = variantPreviewKey(definition, values);
  const defaultKey = variantPreviewKey(definition, resolveVariant(definition, {}));
  if (key === defaultKey) return focusRootFrame(editor, componentId, animate);
  const shape = editor
    .getCurrentPageShapes()
    .find(
      (candidate) =>
        isVariantPreview(candidate) &&
        asVariantPreview(candidate).props.componentId === componentId &&
        variantPreviewKey(definition, asVariantPreview(candidate).props.variantValues) === key,
    );
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

function FlowWorkspace({
  roots,
  flows,
  activeFlow,
  entryRootId,
  routeIds,
  onSelectScreen,
  onAddRoute,
  onRenameFlow,
}: {
  roots: Node[];
  flows: FlowDefinition[];
  activeFlow: FlowId;
  entryRootId?: NodeId;
  routeIds?: NodeId[];
  onSelectScreen: (rootId: NodeId) => void;
  onAddRoute: (rootId: NodeId) => void;
  onRenameFlow: (flowId: FlowId, label: string) => boolean;
}) {
  const screens = roots.filter(
    (root) =>
      !useDocumentStore.getState().editingComponentId ||
      root.id !== useDocumentStore.getState().editingComponentId,
  );
  const routeScreens = flowRouteScreens(screens, activeFlow, routeIds);
  const availableScreens = flowAvailableScreens(screens, activeFlow, routeIds);
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
          <IconButton
            title="Add route to flow"
            onClick={() => {
              const next = availableScreens[0];
              if (next) onAddRoute(next.id);
            }}
            disabled={availableScreens.length === 0}
          >
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
  const commitChanges = useWorkspaceStore((s) => s.commitChanges);
  const screenName = useWorkspaceStore((s) => s.screenName);
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
  const canCommit =
    gitStatus.status === "ready" &&
    (!gitStatus.clean || hasFocusedRoot || syncState.status === "scheduled");
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
          disabled={codegenBusy || !canCommit}
          title="Commit changes on the active branch"
          onClick={async () => {
            if (hasFocusedRoot) await requestCodegen("sync");
            await commitChanges(`Update ${screenName || "design"}`);
          }}
        >
          <GitCommitHorizontal size={14} aria-hidden="true" /> Commit
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
const LEFT_COLUMN_WIDTH_KEY = "rn-canvas.leftColumnWidth";
const LEFT_COLUMN_MIN = 240;
const LEFT_COLUMN_MAX = 420;

function readStoredRightColumnWidth(): number {
  try {
    const raw = Number(window.localStorage.getItem(RIGHT_COLUMN_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= RIGHT_COLUMN_MIN && raw <= RIGHT_COLUMN_MAX) return raw;
  } catch {
    /* storage unavailable */
  }
  return layout.rightColumn;
}

function readStoredLeftColumnWidth(): number {
  try {
    const raw = Number(window.localStorage.getItem(LEFT_COLUMN_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= LEFT_COLUMN_MIN && raw <= LEFT_COLUMN_MAX) return raw;
  } catch {
    /* storage unavailable */
  }
  return layout.leftPanel;
}

function preserveCanvasViewport(editor: Editor | null, action: () => void) {
  if (!editor) {
    action();
    return;
  }
  const center = editor.getViewportPageBounds().center;
  const zoom = editor.getCamera().z;
  action();
  requestAnimationFrame(() => {
    const next = editor.getViewportPageBounds();
    editor.setCamera(
      {
        x: next.w / 2 - center.x * zoom,
        y: next.h / 2 - center.y * zoom,
        z: zoom,
      },
      { immediate: true },
    );
  });
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
  const repoFlowAutoloadedRef = useRef<Set<string>>(new Set());
  const repoComponentHydratedRef = useRef<Set<string>>(new Set());
  const requestDeleteRepoScreenRef = useRef<(screen: RepoPanelScreen) => void>(() => {});

  const [inspectorTab, setInspectorTab] = useState("Design");
  const [workspace, setWorkspace] = useState<WorkspaceMode>("Screen");
  const [componentWorkspaceTab, setComponentWorkspaceTab] =
    useState<ComponentWorkspaceTab>("Canvas");
  const [activeFlow, setActiveFlow] = useState<FlowId>("onboarding");
  const [pendingRemoveFlowId, setPendingRemoveFlowId] = useState<FlowId | null>(null);
  const [confirmDeleteScreen, setConfirmDeleteScreen] = useState<RepoPanelScreen | null>(null);
  const [pendingComponentSwitch, setPendingComponentSwitch] = useState<{
    componentId: NodeId;
    componentName: string;
    currentName: string;
  } | null>(null);
  const [createComponentDraft, setCreateComponentDraft] =
    useState<CreateComponentDraft | null>(null);
  const [activeDesignSystemView, setActiveDesignSystemView] =
    useState<DesignSystemView>("Tokens");
  const [leftColumnWidth, setLeftColumnWidth] = useState(readStoredLeftColumnWidth);
  const [rightColumnWidth, setRightColumnWidth] = useState(readStoredRightColumnWidth);
  const [panelUiHidden, setPanelUiHidden] = useState(false);

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
  const hydrateRepoFlows = useWorkspaceStore((s) => s.hydrateRepoFlows);
  const upsertStoredFlow = useWorkspaceStore((s) => s.upsertFlow);
  const removeStoredFlow = useWorkspaceStore((s) => s.removeFlow);
  const renameStoredRepoScreen = useWorkspaceStore((s) => s.renameRepoScreen);
  const deleteStoredRepoScreen = useWorkspaceStore((s) => s.deleteRepoScreen);
  const openSidecar = useWorkspaceStore((s) => s.openSidecar);
  const importSource = useWorkspaceStore((s) => s.importSource);
  const requestCodegen = useWorkspaceStore((s) => s.requestCodegen);
  const createRepoScreen = useWorkspaceStore((s) => s.createRepoScreen);
  const hydrateSidecarComponents = useWorkspaceStore((s) => s.hydrateSidecarComponents);

  // The document store's selection is the single source of truth. The focused
  // frame is *derived* from it (the root whose subtree holds the selection), and
  // canvas selection is kept in sync with it below — neither side owns its own copy.
  const roots = useDocumentStore((s) => s.roots);
  const selection = useDocumentStore((s) => s.selection);
  const editingComponentId = useDocumentStore((s) => s.editingComponentId);
  const componentRegistry = useDocumentStore((s) => s.components);
  const updateComponent = useDocumentStore((s) => s.updateComponent);
  const getComponentUsage = useDocumentStore((s) => s.getComponentUsage);
  const componentEditDirty = useDocumentStore((s) =>
    s.editingComponentId ? s.componentEditIsDirty() : false,
  );
  const tokens = useDocumentStore((s) => s.tokens);
  const editingComponentDefinition = editingComponentId
    ? componentRegistry[editingComponentId]
    : undefined;
  const editingComponentName = editingComponentId
    ? editingComponentDefinition?.name ?? "Component"
    : null;
  const componentUsage = useMemo(
    () => (editingComponentId ? getComponentUsage(editingComponentId) : []),
    [componentRegistry, editingComponentId, getComponentUsage, roots],
  );
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
      screenCount:
        flow.manifestRoutes?.length ?? flowRouteScreens(screenRoots, flow.id, flow.routes).length,
    }));
  }, [editingComponentId, flows, roots]);
  const screenFlowBadges = useMemo<ScreenFlowBadges>(() => {
    const pathForRoot = new Map<NodeId, string>();
    for (const screen of Object.values(loadedRepoScreens)) {
      pathForRoot.set(screen.rootId, screen.path);
    }
    const badges: ScreenFlowBadges = {};
    const addBadge = (path: string | undefined, label: string) => {
      if (!path) return;
      if (label === path || /\.[jt]sx$|\.rncanvas\.json$/.test(label) || label.includes("/")) return;
      badges[path] = [...(badges[path] ?? []), label];
    };
    for (const flow of flows) {
      const seen = new Set<string>();
      for (const route of flow.manifestRoutes ?? []) {
        if (!route.path || seen.has(route.path)) continue;
        seen.add(route.path);
        addBadge(route.path, flow.label);
      }
      for (const rootId of flow.routes) {
        const path = pathForRoot.get(rootId);
        if (!path || seen.has(path)) continue;
        seen.add(path);
        addBadge(path, flow.label);
      }
    }
    return badges;
  }, [flows, loadedRepoScreens]);
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

  useEffect(() => {
    for (const flow of repoFlowItems) {
      for (const screen of flow.screens) {
        if (!screen.sidecarPath || repoFlowAutoloadedRef.current.has(screen.sidecarPath)) continue;
        repoFlowAutoloadedRef.current.add(screen.sidecarPath);
        void openSidecar(screen.sidecarPath, "merge");
      }
    }
  }, [openSidecar, repoFlowItems]);

  useEffect(() => {
    if (!repoContext?.screens.length) return;
    const sidecarPaths = repoContext.screens
      .filter((screen) => screen.rnCanvas && screen.sidecarPath)
      .map((screen) => screen.sidecarPath as string)
      .filter((path) => {
        if (repoComponentHydratedRef.current.has(path)) return false;
        repoComponentHydratedRef.current.add(path);
        return true;
      });
    if (sidecarPaths.length === 0) return;
    void (async () => {
      for (const path of sidecarPaths) {
        await hydrateSidecarComponents(path);
      }
    })();
  }, [hydrateSidecarComponents, repoContext]);

  useEffect(() => {
    const manifestRoutes = flowsById[activeFlow]?.manifestRoutes;
    if (workspace !== "Flow" || !manifestRoutes?.length) return;
    const screenByPath = new Map<string, RepoPanelScreen>();
    for (const screen of repoContext?.screens ?? []) {
      screenByPath.set(screen.path, screen);
      if (screen.sidecarPath) screenByPath.set(screen.sidecarPath, screen);
    }
    for (const route of manifestRoutes) {
      if (!route.path) continue;
      const screen = screenByPath.get(route.path);
      if (!screen?.sidecarPath || repoFlowAutoloadedRef.current.has(screen.sidecarPath)) continue;
      repoFlowAutoloadedRef.current.add(screen.sidecarPath);
      void openSidecar(screen.sidecarPath, "merge");
    }
  }, [activeFlow, flowsById, openSidecar, repoContext, workspace]);

  useEffect(() => {
    const rootForPath = new Map<string, NodeId>();
    for (const loaded of Object.values(loadedRepoScreens)) {
      rootForPath.set(loaded.path, loaded.rootId);
      if (loaded.sidecarPath) rootForPath.set(loaded.sidecarPath, loaded.rootId);
    }
    const repoFlows = repoFlowItems.flatMap((flow): FlowDefinition[] => {
      const manifestRoutes = flow.screens.map((screen) => ({
        rootId:
          rootForPath.get(screen.path) ??
          (screen.sidecarPath ? rootForPath.get(screen.sidecarPath) : undefined),
        path: screen.path,
        name: displayScreenName(screen),
        screenKey: `path:${screen.path}`,
      }));
      const routes = flow.screens
        .map(
          (screen) =>
            rootForPath.get(screen.path) ??
            (screen.sidecarPath ? rootForPath.get(screen.sidecarPath) : undefined),
        )
        .filter((rootId): rootId is NodeId => !!rootId);
      const rootByScreenPath = new Map(
        flow.screens.flatMap((screen) => {
          const rootId =
            rootForPath.get(screen.path) ??
            (screen.sidecarPath ? rootForPath.get(screen.sidecarPath) : undefined);
          return rootId ? [[screen.path, rootId] as const] : [];
        }),
      );
      return [{
        id: flow.id,
        label: flow.name,
        description: flow.description,
        routes,
        entryRootId: flow.entryPath ? rootByScreenPath.get(flow.entryPath) : routes[0],
        manifestEntryPath: flow.entryPath,
        manifestRoutes,
        manifestEdges: flow.edges.map((edge) => ({
          from: {
            rootId: rootByScreenPath.get(edge.fromPath),
            path: edge.fromPath,
            anchorNodeId: edge.anchorNodeId,
          },
          to: rootByScreenPath.get(edge.toPath),
          toPath: edge.toPath,
          kind: edge.kind,
          condition: edge.condition,
        })),
        edges: flow.edges
          .map((edge): FlowDefinition["edges"][number] | null => {
            const fromRootId = rootByScreenPath.get(edge.fromPath);
            const to = rootByScreenPath.get(edge.toPath);
            return fromRootId && to
              ? {
                  from: { rootId: fromRootId, anchorNodeId: edge.anchorNodeId },
                  to,
                  kind: edge.kind,
                  condition: edge.condition,
                }
              : null;
          })
          .filter((edge): edge is FlowDefinition["edges"][number] => !!edge),
      }];
    });
    hydrateRepoFlows(repoFlows);
  }, [hydrateRepoFlows, loadedRepoScreens, repoFlowItems]);

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
    if (flows.length === 0) return;
    const hasManualFlow = flows.some((flow) => flow.id === activeFlow);
    const hasRepoFlow = repoFlowItems.some((flow) => flow.id === activeFlow);
    if (!hasManualFlow && !hasRepoFlow) {
      setActiveFlow(flows[0].id as FlowId);
    }
  }, [activeFlow, flows, repoFlowItems]);

  // v3 manifests key routes by repo path (manifestRoutes), so the manifest can
  // apply before any screen root is loaded — resolved route ids fill in as
  // screens open. (The old defer-until-roots dance is gone with draft seeding.)
  const applyFlowManifest = useCallback((body: FlowManifest) => {
    applyFlowManifestToStore(body);
    const firstFlowId = body.flows[0]?.id;
    if (firstFlowId) {
      setActiveFlow((current) =>
        body.flows.some((flow) => flow.id === current) ? current : (firstFlowId as FlowId),
      );
    }
  }, [applyFlowManifestToStore]);

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
        if (s.editingComponentId && rootId !== s.editingComponentId) {
          syncCanvasFrameSelection(editor, s.editingComponentId, true);
          s.setSelection([s.editingComponentId]);
          return;
        }
        const curRoot = findRootContaining(Object.values(s.roots), s.selection[0] ?? "");
        if (curRoot?.id !== rootId) s.setSelection([rootId]);
      },
      { scope: "session" },
    );

  }, []);

  // First-run bootstrap: scaffold a starter screen only when the *repo* has no
  // screens (the in-memory store is always empty at mount — repo screens load
  // lazily — so it must not be the signal). Runs at most once per session.
  // TODO: replace this with a dedicated repo bootstrap/onboarding flow.
  const bootstrapAttemptedRef = useRef(false);
  useEffect(() => {
    if (!repoContext || bootstrapAttemptedRef.current) return;
    bootstrapAttemptedRef.current = true;
    if (repoContext.screens.length > 0) return;
    if (Object.keys(useDocumentStore.getState().roots).length > 0) return;
    void createRepoScreen();
  }, [repoContext, createRepoScreen]);

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

  useEffect(() => {
    if (!editingComponentId) return;
    setWorkspace("Component");
    setComponentWorkspaceTab("Canvas");
    setInspectorTab("Design");
    if (workspace === "Flow" || workspace === "Design System") return;
    pendingFocusRootIdRef.current = editingComponentId;
    const editor = editorRef.current;
    if (editor) focusRootFrame(editor, editingComponentId);
  }, [editingComponentId, workspace]);

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

      if (
        modifier &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "." || event.code === "Period")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        preserveCanvasViewport(editorRef.current, () => {
          setPanelUiHidden((hidden) => {
            const next = !hidden;
            setStatus(next ? "Panel UI hidden" : "Panel UI visible");
            return next;
          });
        });
        return;
      }

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

      if (selectedRootIds.length === 1) {
        const rootId = selectedRootIds[0];
        const workspaceState = useWorkspaceStore.getState();
        const loaded = Object.values(workspaceState.loadedRepoScreens).find(
          (screen) => screen.rootId === rootId,
        );
        const repoScreen = loaded
          ? workspaceState.repoContext?.screens.find(
              (screen) =>
                screen.path === loaded.path ||
                screen.path === loaded.sidecarPath ||
                screen.sidecarPath === loaded.path ||
                screen.sidecarPath === loaded.sidecarPath,
            ) ?? {
              path: loaded.path,
              name: loaded.screenName ?? loaded.path,
              kind: "source" as const,
              sidecarPath: loaded.sidecarPath,
              routeKind: "unknown" as const,
              rnCanvas: !!loaded.sidecarPath,
            }
          : undefined;
        if (repoScreen?.rnCanvas && repoScreen.sidecarPath) {
          event.preventDefault();
          event.stopImmediatePropagation();
          requestDeleteRepoScreenRef.current(repoScreen);
          return;
        }
      }

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
          syncVariantPreviewShapes(editor);
        },
        { history: "ignore", ignoreShapeLock: true },
      );
    } finally {
      reconcilingShapesRef.current = false;
    }
  }, [componentRegistry, editingComponentId, roots]);

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
            syncVariantPreviewShapes(editor);
          },
          { history: "ignore", ignoreShapeLock: true },
        );
      } finally {
        reconcilingShapesRef.current = false;
      }
    });
    return unsubscribe;
  }, []);

  const addFrame = useCallback(async () => {
    const root = await createRepoScreen();
    if (!root) return null;
    pendingFocusRootIdRef.current = root.id;
    return root;
  }, [createRepoScreen]);

  const setCanvasTool = useCallback((tool: CanvasTool) => {
    useStudioStore.getState().setCanvasTool(tool);
    editorRef.current?.setCurrentTool(tool);
    const label = tool.charAt(0).toUpperCase() + tool.slice(1);
    setStatus(`${label} tool active`);
  }, []);

  const renameEditingComponent = useCallback((name: string) => {
    if (!editingComponentId) return false;
    try {
      updateComponent(editingComponentId, { name });
      setStatus(`Renamed component to ${name}`);
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Component rename failed");
      return false;
    }
  }, [editingComponentId, setStatus, updateComponent]);

  const selectComponentVariant = useCallback(
    (values: Record<string, string>) => {
      useStudioStore.getState().setActiveVariantAll(values);
      const editor = editorRef.current;
      const definition = editingComponentId ? componentRegistry[editingComponentId] : undefined;
      if (!editor || !editingComponentId || !definition) return;
      if (!focusVariantPreviewFrame(editor, editingComponentId, definition, values)) {
        focusRootFrame(editor, editingComponentId);
      }
    },
    [componentRegistry, editingComponentId],
  );

  const selectComponentUsage = useCallback(
    (rootId: NodeId, nodeId: NodeId) => {
      const store = useDocumentStore.getState();
      try {
        if (store.editingComponentId) store.endComponentEdit(true);
        if (store.roots[rootId]) {
          store.setSelection([nodeId]);
          setWorkspace("Screen");
          setComponentWorkspaceTab("Canvas");
          const editor = editorRef.current;
          if (editor) focusRootFrame(editor, rootId);
          setStatus("Selected placed component instance");
          return;
        }
        const definition = store.components[rootId];
        if (definition) {
          store.beginComponentEdit(rootId);
          store.setSelection([nodeId]);
          setWorkspace("Component");
          setComponentWorkspaceTab("Canvas");
          setInspectorTab("Design");
          setStatus(`Editing ${definition.name} usage`);
          return;
        }
        setStatus("Usage target not found");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not open usage");
      }
    },
    [setStatus],
  );

  const openComponentForEdit = useCallback(
    (componentId: NodeId) => {
      const store = useDocumentStore.getState();
      const definition = store.components[componentId];
      if (!definition) {
        setStatus("Component not found");
        return;
      }
      const currentId = store.editingComponentId;
      if (currentId === componentId) {
        setWorkspace("Component");
        setComponentWorkspaceTab("Canvas");
        setInspectorTab("Design");
        setStatus(`Editing ${definition.name}`);
        return;
      }
      if (currentId) {
        const currentName = store.components[currentId]?.name ?? "current component";
        const hasUserEdits = store.componentEditIsDirty();
        if (!hasUserEdits) {
          try {
            store.endComponentEdit(true);
            store.beginComponentEdit(componentId);
            setWorkspace("Component");
            setComponentWorkspaceTab("Canvas");
            setInspectorTab("Design");
            setStatus(`Editing ${definition.name}`);
          } catch (error) {
            setStatus(error instanceof Error ? error.message : "Component switch failed");
          }
          return;
        }
        setPendingComponentSwitch({
          componentId,
          componentName: definition.name,
          currentName,
        });
        setStatus(`Save or discard ${currentName} edits to switch`);
        return;
      }
      try {
        store.beginComponentEdit(componentId);
        setWorkspace("Component");
        setComponentWorkspaceTab("Canvas");
        setInspectorTab("Design");
        setStatus(`Editing ${definition.name}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Component edit failed");
      }
    },
    [setStatus],
  );

  const switchComponentForEdit = useCallback(
    (commitCurrent: boolean) => {
      const pending = pendingComponentSwitch;
      if (!pending) return;
      const store = useDocumentStore.getState();
      try {
        if (store.editingComponentId) store.endComponentEdit(commitCurrent);
        store.beginComponentEdit(pending.componentId);
        setPendingComponentSwitch(null);
        setWorkspace("Component");
        setComponentWorkspaceTab("Canvas");
        setInspectorTab("Design");
        setStatus(
          `${commitCurrent ? "Saved" : "Discarded"} ${pending.currentName}; editing ${pending.componentName}`,
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Component switch failed");
      }
    },
    [pendingComponentSwitch, setStatus],
  );

  const requestCreateComponentFromLayer = useCallback(
    (rootId: NodeId, nodeId: NodeId) => {
      const store = useDocumentStore.getState();
      if (store.editingComponentId) {
        setStatus("Finish component edit before creating a nested component");
        return;
      }
      const root = store.roots[rootId];
      const node = root ? findNode(root, nodeId) : undefined;
      if (!root || !node) {
        setStatus("Select a layer to create a component");
        return;
      }
      if (node.id === root.id) {
        setStatus("Select a layer inside the screen to create a component");
        return;
      }
      if (node.type === "ComponentInstance") {
        setStatus("Instances cannot be promoted into new components");
        return;
      }
      if (node.design?.locked) {
        setStatus("Unlock the layer before creating a component");
        return;
      }
      const fallback = node.design?.name?.trim() || node.type;
      const base = componentDisplayPathFromInput(fallback, node.type);
      setCreateComponentDraft({
        rootId,
        nodeId,
        nodeLabel: fallback,
        nodeType: node.type,
        childCount: childCountFor(node),
        displayPath: uniqueComponentDisplayPath(base, store.components),
        preset: node.type === "Pressable" ? "button" : node.type === "View" ? "card" : "none",
      });
    },
    [setStatus],
  );

  const confirmCreateComponent = useCallback(() => {
    const draft = createComponentDraft;
    if (!draft) return;
    if (!draft.displayPath.trim()) return;
    const store = useDocumentStore.getState();
    const base = componentDisplayPathFromInput(draft.displayPath, draft.nodeType);
    const name = uniqueComponentDisplayPath(base, store.components);
    try {
      store.promoteToComponent(draft.rootId, draft.nodeId, name);
      const nextStore = useDocumentStore.getState();
      const root = nextStore.roots[draft.rootId];
      const placed = root ? findNode(root, draft.nodeId) : undefined;
      if (placed?.type === "ComponentInstance") {
        const definition = nextStore.components[placed.componentId];
        if (definition) {
          const enhanced = applyCreationPreset(definition, draft.preset);
          if (enhanced !== definition) {
            useDocumentStore.getState().updateComponent(placed.componentId, enhanced);
          }
        }
      }
      setCreateComponentDraft(null);
      if (placed?.type === "ComponentInstance") {
        openComponentForEdit(placed.componentId);
        setStatus(`Created ${name}; editing definition`);
      } else {
        setWorkspace("Screen");
        setStatus(`Created ${name}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Component creation failed");
    }
  }, [createComponentDraft, openComponentForEdit, setStatus]);

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

  const loadedRepoScreenForPanelScreen = useCallback(
    (screen: RepoPanelScreen): ActiveRepoScreen | undefined =>
      loadedRepoScreens[screen.path] ??
      (screen.sidecarPath ? loadedRepoScreens[screen.sidecarPath] : undefined) ??
      Object.values(loadedRepoScreens).find(
        (loaded) =>
          loaded.path === screen.path ||
          loaded.path === screen.sidecarPath ||
          loaded.sidecarPath === screen.path ||
          loaded.sidecarPath === screen.sidecarPath,
      ),
    [loadedRepoScreens],
  );

  const renameRepoScreen = useCallback(
    (screen: RepoPanelScreen, name: string) => {
      const loaded = loadedRepoScreenForPanelScreen(screen);
      if (!loaded) {
        setStatus("Open the screen to rename it");
        return;
      }
      renameStoredRepoScreen(loaded.rootId, name);
    },
    [loadedRepoScreenForPanelScreen, renameStoredRepoScreen, setStatus],
  );

  const requestDeleteRepoScreen = useCallback((screen: RepoPanelScreen) => {
    if (!screen.rnCanvas || !screen.sidecarPath) {
      setStatus("Only RNCanvas-owned screens can be deleted");
      return;
    }
    setConfirmDeleteScreen(screen);
    setStatus(`Confirm delete ${displayScreenName(screen)}`);
  }, [setStatus]);
  requestDeleteRepoScreenRef.current = requestDeleteRepoScreen;

  const confirmDeleteRepoScreen = useCallback(() => {
    const screen = confirmDeleteScreen;
    if (!screen) return;
    setConfirmDeleteScreen(null);
    void deleteStoredRepoScreen(screen).catch((error) => {
      setStatus(error instanceof Error ? error.message : "Screen delete failed");
    });
  }, [confirmDeleteScreen, deleteStoredRepoScreen, setStatus]);



  // Read-only context crumb mirroring the active workspace (and its object where known).
  const activeFlowDefinition = flowsById[activeFlow];
  const flowInspectorScreens = Object.values(roots).filter((root) => root.id !== editingComponentId);
  const flowInspectorRouteScreens = activeFlowDefinition
    ? flowRouteScreens(flowInspectorScreens, activeFlow, activeFlowDefinition.routes)
    : [];
  const flowInspectorAvailableScreens = activeFlowDefinition
    ? flowAvailableScreens(flowInspectorScreens, activeFlow, activeFlowDefinition.routes)
    : [];
  const isComponentWorkspace = workspace === "Component" && !!editingComponentDefinition;
  const workspaceContext =
    isComponentWorkspace
      ? `Component · ${editingComponentName}`
      : workspace === "Flow"
        ? `Flow · ${flowPanelItems.find((flow) => flow.id === activeFlow)?.label ?? "Untitled"}`
        : workspace === "Design System"
          ? "Design System"
          : "Screen";
  const createComponentCodeName = createComponentDraft
    ? toComponentFileName(
        uniqueComponentDisplayPath(
          componentDisplayPathFromInput(createComponentDraft.displayPath, createComponentDraft.nodeType),
          componentRegistry,
        ),
      )
    : null;
  const createComponentPresets = createComponentDraft
    ? supportedCreationPresets(createComponentDraft.nodeType)
    : [];

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
      {!panelUiHidden && (
        <TopBar
          workspaceContext={workspaceContext}
          onOpenRepoSettings={openRepoSettings}
          onOpenCodePanel={() => setInspectorTab("Code")}
        />
      )}

      {/* WORKBENCH: left panel · canvas (with floating bottom toolbar) · right column */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {!panelUiHidden && (
          <>
            <div
              className="studio-chrome"
              style={{
                flex: `0 0 ${leftColumnWidth}px`,
                width: leftColumnWidth,
                minHeight: 0,
                display: "flex",
              }}
            >
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
                onRenameRepoScreen={renameRepoScreen}
                onOpenComponent={openComponentForEdit}
                onCreateComponentFromSelection={requestCreateComponentFromLayer}
                screenFlowBadges={screenFlowBadges}
                gitStatus={gitStatus}
                sidecarPath={sidecarPath}
                activeRepoScreen={activeRepoScreen}
                loadedRepoScreens={loadedRepoScreens}
                repoContext={repoContext}
              />
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize navigation"
              title="Drag to resize"
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                const width = Math.min(
                  LEFT_COLUMN_MAX,
                  Math.max(LEFT_COLUMN_MIN, event.clientX),
                );
                setLeftColumnWidth(width);
                try {
                  window.localStorage.setItem(LEFT_COLUMN_WIDTH_KEY, String(width));
                } catch {
                  /* storage unavailable */
                }
              }}
              onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
              className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent-line"
            />
          </>
        )}

        <div className="relative flex min-w-0 flex-1 flex-col">
          {workspace === "Flow" ? (
            <FlowWorkspace
              roots={Object.values(roots)}
              flows={flows}
              activeFlow={activeFlow}
              entryRootId={activeFlowDefinition?.entryRootId}
              routeIds={activeFlowDefinition?.routes}
              onSelectScreen={selectScreenFromWorkspace}
              onAddRoute={addScreenToFlow}
              onRenameFlow={renameFlow}
            />
          ) : workspace === "Design System" ? (
            <DesignSystemWorkspace
              tokens={Object.values(tokens)}
              activeView={activeDesignSystemView}
              onViewChange={setActiveDesignSystemView}
              onCreateToken={createToken}
            />
          ) : isComponentWorkspace ? (
            <ComponentWorkspace
              definition={editingComponentDefinition}
              dirty={componentEditDirty}
              roots={roots}
              components={componentRegistry}
              usage={componentUsage}
              activeTab={componentWorkspaceTab}
              onTabChange={setComponentWorkspaceTab}
              onRename={renameEditingComponent}
              onSelectVariant={selectComponentVariant}
              onSelectUsage={selectComponentUsage}
              onCancel={() => {
                useDocumentStore.getState().endComponentEdit(false);
                setWorkspace("Screen");
                setStatus(`Canceled ${editingComponentName ?? "component"} edits`);
              }}
              onDone={() => {
                useDocumentStore.getState().endComponentEdit(true);
                setWorkspace("Screen");
                setStatus(`Saved ${editingComponentName ?? "component"}`);
              }}
            >
              <div
                data-testid="rn-canvas-surface"
                className="relative min-h-0 h-full"
                onPointerDownCapture={(event) => {
                  if (event.button !== 0) return;
                  const target = event.target;
                  if (!(target instanceof Element)) return;
                  if (target.closest("[data-rn-root-id]")) return;
                  if (target.closest("[data-rn-variant-component-id]")) return;
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
            </ComponentWorkspace>
          ) : (
            <>
              {!panelUiHidden && (
                <ToolRail
                  onCanvasTool={setCanvasTool}
                  onAddFrame={addFrame}
                  // A primitive can be armed whenever there's any screen to draw into —
                  // the target frame is resolved from the cursor, not a prior selection.
                  canAddPrimitive={Object.keys(roots).length > 0}
                />
              )}
              <div
                data-testid="rn-canvas-surface"
                className="relative min-h-0 flex-1"
                onPointerDownCapture={(event) => {
                  if (event.button !== 0) return;
                  const target = event.target;
                  if (!(target instanceof Element)) return;
                  if (target.closest("[data-rn-root-id]")) return;
                  if (target.closest("[data-rn-variant-component-id]")) return;
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
        {!panelUiHidden && (
          <>
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
                      tabs={
                        workspace === "Component"
                          ? ["Design", "Code", "History"]
                          : ["Design", "Code", "History"]
                      }
                      active={inspectorTab}
                      onSelect={setInspectorTab}
                      variant="underline"
                    />
                  </div>
                  <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                    {inspectorTab === "Design" ? (
                      <ErrorBoundary label="Inspector" resetKey={selection[0] ?? null}>
                        {isComponentWorkspace && editingComponentId ? (
                          <ComponentEditPanel componentId={editingComponentId} />
                        ) : (
                          <Inspector rootId={focusedRootId} />
                        )}
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
          </>
        )}
      </div>
      {confirmDeleteScreen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-md"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmDeleteScreen(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-screen-title"
            className="studio-chrome w-[min(420px,100%)] rounded-sm border border-line bg-chrome shadow-popover"
          >
            <div className="flex items-start gap-sm border-b border-line-soft p-lg">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-amber/50 bg-amber/10 text-amber">
                <AlertTriangle size={16} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div id="delete-screen-title" className="break-words text-sm font-semibold text-ink">
                  Delete {displayScreenName(confirmDeleteScreen)}?
                </div>
                <div className="mt-2xs text-xs text-ink-faint">
                  This removes real repo files from the connected project.
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-xs p-lg">
              <div className="rounded-sm border border-line-soft bg-chrome-2 p-sm font-mono text-xs text-ink-dim">
                <div className="break-all">{confirmDeleteScreen.path}</div>
                {confirmDeleteScreen.sidecarPath && (
                  <div className="mt-2xs break-all text-ink-faint">
                    {confirmDeleteScreen.sidecarPath}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-xs border-t border-line-soft p-md">
              <Button variant="ghost" onClick={() => setConfirmDeleteScreen(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                className="border-amber bg-amber text-chrome hover:bg-amber"
                onClick={confirmDeleteRepoScreen}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
      {pendingComponentSwitch && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-md"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingComponentSwitch(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="switch-component-title"
            className="studio-chrome w-[min(440px,100%)] rounded-sm border border-line bg-chrome shadow-popover"
          >
            <div className="flex items-start gap-sm border-b border-line-soft p-lg">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-accent-line bg-accent-soft text-accent">
                <AlertTriangle size={16} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div id="switch-component-title" className="break-words text-sm font-semibold text-ink">
                  Switch to {pendingComponentSwitch.componentName}?
                </div>
                <div className="mt-2xs text-xs text-ink-faint">
                  Save or discard edits to {pendingComponentSwitch.currentName} before opening the next component.
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-xs border-t border-line-soft p-md">
              <Button variant="ghost" onClick={() => setPendingComponentSwitch(null)}>
                Cancel
              </Button>
              <Button variant="ghost" onClick={() => switchComponentForEdit(false)}>
                Discard and switch
              </Button>
              <Button variant="primary" onClick={() => switchComponentForEdit(true)}>
                Save and switch
              </Button>
            </div>
          </div>
        </div>
      )}
      {createComponentDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-md"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCreateComponentDraft(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-component-title"
            className="studio-chrome w-[min(460px,100%)] rounded-sm border border-line bg-chrome shadow-popover"
          >
            <div className="flex items-start gap-sm border-b border-line-soft p-lg">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-accent-line bg-accent-soft text-accent">
                <FileJson2 size={16} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div id="create-component-title" className="break-words text-sm font-semibold text-ink">
                  Create component from selection
                </div>
                <div className="mt-2xs text-xs text-ink-faint">
                  The selected layer becomes a reusable definition and this screen keeps an instance.
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-md p-lg">
              <label className="flex flex-col gap-xs">
                <span className="text-xs font-semibold text-ink-faint">Display path</span>
                <input
                  autoFocus
                  value={createComponentDraft.displayPath}
                  onChange={(event) =>
                    setCreateComponentDraft((current) =>
                      current ? { ...current, displayPath: event.target.value } : current,
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setCreateComponentDraft(null);
                    if (event.key === "Enter") confirmCreateComponent();
                  }}
                  className="h-8 rounded-sm border border-line bg-chrome-2 px-sm text-sm text-ink transition-colors hover:border-line focus-visible:border-accent-line focus-visible:outline-none"
                />
              </label>
              {createComponentPresets.length > 1 && (
                <div className="flex flex-col gap-xs">
                  <span className="text-xs font-semibold text-ink-faint">Preset</span>
                  <div className="grid grid-cols-3 gap-xs">
                    {createComponentPresets.map((preset) => {
                      const selected = createComponentDraft.preset === preset;
                      const label =
                        preset === "button" ? "Button"
                        : preset === "card" ? "Card"
                        : "None";
                      return (
                        <button
                          key={preset}
                          type="button"
                          aria-pressed={selected}
                          onClick={() =>
                            setCreateComponentDraft((current) =>
                              current ? { ...current, preset } : current,
                            )
                          }
                          className={cn(
                            "h-8 rounded-sm border px-sm text-sm font-medium transition-colors",
                            selected
                              ? "border-accent bg-accent-soft text-accent"
                              : "border-line bg-chrome-2 text-ink-dim hover:bg-raised hover:text-ink",
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="rounded-sm border border-line-soft bg-chrome-2 p-sm">
                <div className="text-xs font-semibold text-ink-faint">Included</div>
                <div className="mt-xs flex min-w-0 items-center gap-xs text-sm text-ink">
                  <span className="truncate font-medium">{createComponentDraft.nodeLabel}</span>
                  <span className="text-ink-faint">{createComponentDraft.nodeType}</span>
                  {createComponentDraft.childCount > 0 && (
                    <span className="ml-auto shrink-0 text-xs text-ink-faint">
                      {createComponentDraft.childCount} child{createComponentDraft.childCount === 1 ? "" : "ren"}
                    </span>
                  )}
                </div>
              </div>
              <div className="grid gap-xs text-xs text-ink-faint">
                <div>
                  Emits as <span className="font-mono text-ink">{createComponentCodeName}</span>
                </div>
                {createComponentDraft.preset === "button" && (
                  <div>Adds label and disabled props plus default, hover, pressed, and disabled states.</div>
                )}
                {createComponentDraft.preset === "card" && (
                  <div>Adds title, subtitle, and background instance controls when matching layers exist.</div>
                )}
                <div>Opens the new definition after creation.</div>
              </div>
            </div>
            <div className="flex justify-end gap-xs border-t border-line-soft p-md">
              <Button variant="ghost" onClick={() => setCreateComponentDraft(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!createComponentDraft.displayPath.trim()}
                onClick={confirmCreateComponent}
              >
                Create and edit
              </Button>
            </div>
          </div>
        </div>
      )}
      <LayerContextMenu onCreateComponentFromLayer={requestCreateComponentFromLayer} />
      <Toasts />
    </div>
    </TooltipProvider>
  );
}
