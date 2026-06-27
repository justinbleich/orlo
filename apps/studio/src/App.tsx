import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileCode2,
  FileJson2,
  FolderOpen,
  RefreshCw,
  Redo2,
  Save,
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
  type Node,
  type NodeId,
  type RNPrimitive,
} from "@rn-canvas/document";
import { FrameShapeUtil, type FrameShape } from "./shapes/FrameShape";
import { Inspector } from "./Inspector";
import { ErrorBoundary } from "./ErrorBoundary";
import { color, layout, radius, space, text } from "./studio-theme";
import { Eyebrow, LeftPanel, Tabs, ToolRail } from "./shell";
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
      padding: 16,
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

export default function App() {
  const editorRef = useRef<Editor | null>(null);
  const reconcilingShapesRef = useRef(false);
  const codegenBusyRef = useRef(false);
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipCodeSyncRef = useRef(false);
  const skipNextPathSyncRef = useRef(false);
  const pathSyncReadyRef = useRef(false);
  const syncRootIdRef = useRef<NodeId | null>(null);

  const [status, setStatus] = useState("Drag a frame · resize from handles · add from the toolbar");
  const [inspectorTab, setInspectorTab] = useState("Design");
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
  const [canvasCanUndo, setCanvasCanUndo] = useState(false);
  const [canvasCanRedo, setCanvasCanRedo] = useState(false);

  // The document store's selection is the single source of truth. The focused
  // frame is *derived* from it (the root whose subtree holds the selection), and
  // canvas selection is kept in sync with it below — neither side owns its own copy.
  const roots = useDocumentStore((s) => s.roots);
  const selection = useDocumentStore((s) => s.selection);
  const editingComponentId = useDocumentStore((s) => s.editingComponentId);
  const componentRegistry = useDocumentStore((s) => s.components);
  const editingComponentName = editingComponentId
    ? componentRegistry[editingComponentId]?.name ?? "Component"
    : null;
  const focusedRoot = useMemo(
    () => findRootContaining(Object.values(roots), selection[0] ?? ""),
    [roots, selection],
  );
  const focusedRootId = focusedRoot?.id ?? null;
  const artifacts = useMemo(() => codeArtifacts(codegenResult), [codegenResult]);
  const activeArtifact =
    artifacts.find((artifact) => artifact.id === activeArtifactId) ?? artifacts[0] ?? null;
  if (focusedRootId && focusedRootId !== editingComponentId) {
    syncRootIdRef.current = focusedRootId;
  }
  const screenNameRef = useRef(screenName);
  const targetPathRef = useRef(targetPath);
  screenNameRef.current = screenName;
  targetPathRef.current = targetPath;

  const canUndo = useDocumentStore((s) => s.past.length > 0);
  const canRedo = useDocumentStore((s) => s.future.length > 0);
  const hasActiveInteraction = useDocumentStore((s) => !!s.interaction);
  const undo = useDocumentStore((s) => s.undo);
  const redo = useDocumentStore((s) => s.redo);

  useEffect(() => startMcpBridge(handleMcpCommand), []);

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
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "Repository load failed");
    }
  }, []);

  const connectRepo = useCallback(async () => {
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
      const nextPath = body.repoPath ?? repoDraft;
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
      skipNextPathSyncRef.current = true;
      setStatus(`Connected ${nextPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Repository connection failed";
      setRepoError(message);
      setStatus(message);
    } finally {
      setRepoBusy(false);
    }
  }, [refreshGitStatus, repoDraft]);

  useEffect(() => {
    void loadRepo();
    void refreshGitStatus();
    const timer = setInterval(() => void refreshGitStatus(), 5_000);
    return () => clearInterval(timer);
  }, [loadRepo, refreshGitStatus]);

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
    // Dark canvas to match the studio shell (chrome theming, not artboard).
    editor.user.updateUserPreferences({ colorScheme: "dark" });

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
        const sel = editor.getOnlySelectedShape();
        if (!sel || !isFrame(sel)) return;
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

  // Store → canvas: keep the focused frame selected on the canvas. Guarded so it
  // can't ping-pong with the listener above.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !focusedRoot) return;
    const shape = editor
      .getCurrentPageShapes()
      .find((s) => isFrame(s) && asFrame(s).props.rootId === focusedRoot.id);
    if (shape && editor.getOnlySelectedShape()?.id !== shape.id) {
      editor.select(shape.id);
    }
  }, [focusedRoot]);

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
          const selectedShape = selectedRoot
            ? editor
                .getCurrentPageShapes()
                .find(
                  (shape) =>
                    isFrame(shape) && asFrame(shape).props.rootId === selectedRoot.id,
                )
            : undefined;
          if (selectedShape) editor.select(selectedShape.id);
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
        if (mode === "sync") void refreshGitStatus();
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
    [refreshGitStatus, syncRoot],
  );

  const openSidecar = useCallback(async () => {
    setCodegenBusy(true);
    setCodegenError(null);
    try {
      const res = await fetch("/api/documents/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sidecarPath }),
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
      setStatus(`Opened ${opened.sidecarPath}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Document load failed";
      setCodegenError(message);
      setStatus(message);
    } finally {
      setCodegenBusy(false);
    }
  }, [resetCanvasHistory, sidecarPath]);

  const importSource = useCallback(async () => {
    setCodegenBusy(true);
    setCodegenError(null);
    try {
      const res = await fetch("/api/documents/import-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath: targetPath }),
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
      setStatus(`Imported ${imported.sourcePath}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Code import failed";
      setCodegenError(message);
      setStatus(message);
    } finally {
      setCodegenBusy(false);
    }
  }, [resetCanvasHistory, targetPath]);

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
    if (!pathSyncReadyRef.current) {
      pathSyncReadyRef.current = true;
      return;
    }
    if (skipNextPathSyncRef.current) {
      skipNextPathSyncRef.current = false;
      return;
    }
    if (!Object.keys(useDocumentStore.getState().roots).length) return;
    scheduleAutoSync();
  }, [screenName, targetPath, scheduleAutoSync]);

  const btn: React.CSSProperties = {
    background: color.chrome2,
    color: color.ink,
    border: `1px solid ${color.line}`,
    borderRadius: radius.base,
    padding: `${space.xs} ${space.md}`,
    fontSize: text.sm,
  };
  const iconBtn: React.CSSProperties = {
    ...btn,
    width: 28,
    height: 28,
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  // Top-bar placeholders (structure only; controls fill in across phases).
  const crumbStyle: React.CSSProperties = { color: color.inkDim, fontSize: text.base };
  const fieldStyle: React.CSSProperties = {
    background: color.chrome2,
    color: color.ink,
    border: `1px solid ${color.line}`,
    borderRadius: radius.base,
    padding: `${space.xs} ${space.sm}`,
    fontSize: text.sm,
    width: "100%",
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
        className="studio-chrome"
        style={{
          flex: `0 0 ${layout.topbar}px`,
          height: layout.topbar,
          padding: `0 ${space.lg}`,
          background: color.chrome,
          borderBottom: `1px solid ${color.line}`,
          display: "flex",
          alignItems: "center",
          gap: space.md,
        }}
      >
        <strong style={{ color: color.ink, fontSize: text.lg }}>RN Canvas</strong>
        <span style={crumbStyle}>Untitled</span>
        <div style={{ display: "flex", gap: space.xs }}>
          <button
            type="button"
            style={iconBtn}
            disabled={!undoAvailable}
            onClick={undoLatest}
            title="Undo"
          >
            <Undo2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            style={iconBtn}
            disabled={!redoAvailable}
            onClick={redoLatest}
            title="Redo"
          >
            <Redo2 size={16} aria-hidden="true" />
          </button>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: space.sm }}>
          <span
            title={gitStatus.status === "error" ? gitStatus.message : gitLabel}
            style={{
              color:
                gitStatus.status === "ready" && !gitStatus.clean
                  ? color.ink
                  : gitStatus.status === "error"
                    ? color.amber
                    : color.inkFaint,
              fontSize: text.xs,
              maxWidth: 180,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {gitLabel}
          </span>
          <span
            title={syncState.status === "error" ? syncState.message : syncLabel}
            style={{
              color: syncState.status === "error" ? color.amber : color.inkFaint,
              fontSize: text.xs,
              maxWidth: 220,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {syncLabel}
          </span>
          <button
            type="button"
            style={btn}
            disabled={codegenBusy || !focusedRoot}
            title="Sync the canvas document with React Native files"
            onClick={() => void requestCodegen("sync")}
          >
            Sync now
          </button>
        </div>
      </header>

      {/* WORKBENCH: left panel · canvas (with floating bottom toolbar) · right column */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <LeftPanel onAddFrame={addFrame} />

        <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
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
              className="studio-chrome"
              style={{
                position: "absolute",
                top: space.md,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 10,
                display: "flex",
                alignItems: "center",
                gap: space.md,
                padding: `${space.xs} ${space.md}`,
                borderRadius: radius.pill,
                border: `1px solid ${color.accentLine}`,
                background: color.raised,
                color: color.ink,
                fontSize: text.sm,
                boxShadow: "var(--shadow-popover)",
              }}
            >
              <span>
                Component / <strong>{editingComponentName}</strong>
              </span>
              <span style={{ color: color.inkFaint }}>Focused definition</span>
              <button
                type="button"
                onClick={() => useDocumentStore.getState().endComponentEdit(false)}
                style={{ border: 0, background: "transparent", color: color.inkDim, fontSize: text.sm, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => useDocumentStore.getState().endComponentEdit(true)}
                style={{
                  border: `1px solid ${color.accent}`,
                  background: color.accent,
                  color: color.chrome,
                  borderRadius: radius.sm,
                  padding: `${space.xs} ${space.sm}`,
                  fontSize: text.sm,
                  cursor: "pointer",
                }}
              >
                Done
              </button>
            </div>
          )}
          <div
            data-testid="rn-canvas-surface"
            style={{ position: "relative", flex: 1, minHeight: 0 }}
          >
            <Tldraw
              onMount={onMount}
              shapeUtils={shapeUtils}
              components={components}
              overrides={overrides}
            />
          </div>
          <div
            className="studio-chrome"
            style={{
              flex: "0 0 auto",
              padding: `${space.xs} ${space.md}`,
              borderTop: `1px solid ${color.line}`,
              background: color.chrome,
              color: color.inkDim,
              fontSize: text.sm,
            }}
          >
            {status}
          </div>
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
              {/* Interact (interactions/navigation) is phase 3 — not shown in v1. */}
              <Tabs
                tabs={["Design", "Code"]}
                active={inspectorTab}
                onSelect={setInspectorTab}
              />
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
              {inspectorTab === "Design" ? (
                <ErrorBoundary label="Inspector" resetKey={selection[0] ?? null}>
                  <Inspector rootId={focusedRootId} />
                </ErrorBoundary>
              ) : (
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
                  <div style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
                      <span style={{ color: color.inkDim, fontSize: text.xs }}>
                        Connected repo
                      </span>
                      <input
                        value={repoDraft}
                        onChange={(e) => setRepoDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void connectRepo();
                          else if (e.key === "Escape") setRepoDraft(repoPath);
                        }}
                        placeholder="/path/to/app"
                        spellCheck={false}
                        style={fieldStyle}
                      />
                    </label>
                    <div style={{ display: "flex", gap: space.xs }}>
                      <button
                        type="button"
                        style={{ ...btn, flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: space.xs }}
                        disabled={repoBusy || !repoDraft.trim()}
                        onClick={() => void connectRepo()}
                      >
                        <FolderOpen size={14} aria-hidden="true" /> Connect
                      </button>
                      <button
                        type="button"
                        title="Refresh Git status"
                        style={iconBtn}
                        onClick={() => void refreshGitStatus()}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                      </button>
                    </div>
                    {repoError && (
                      <p style={{ color: color.amber, fontSize: text.xs, margin: 0 }}>
                        {repoError}
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
                      <span style={{ color: color.inkDim, fontSize: text.xs }}>Document</span>
                      <input
                        value={sidecarPath}
                        onChange={(e) => setSidecarPath(e.target.value)}
                        style={fieldStyle}
                      />
                    </label>
                    <div style={{ display: "flex", gap: space.xs }}>
                      <button
                        type="button"
                        style={{ ...btn, flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: space.xs }}
                        disabled={codegenBusy}
                        onClick={() => void openSidecar()}
                      >
                        <FolderOpen size={14} aria-hidden="true" /> Open
                      </button>
                      <button
                        type="button"
                        style={{ ...btn, flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: space.xs }}
                        disabled={codegenBusy}
                        onClick={() => void importSource()}
                      >
                        <RefreshCw size={14} aria-hidden="true" /> Import
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
                      <span style={{ color: color.inkDim, fontSize: text.xs }}>Screen</span>
                      <input
                        value={screenName}
                        onChange={(e) => setScreenName(e.target.value)}
                        onBlur={() => void requestCodegen("preview")}
                        style={fieldStyle}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
                      <span style={{ color: color.inkDim, fontSize: text.xs }}>Code path</span>
                      <input
                        value={targetPath}
                        onChange={(e) => setTargetPath(e.target.value)}
                        style={fieldStyle}
                      />
                    </label>
                    <div style={{ display: "flex", gap: space.xs }}>
                      <button
                        type="button"
                        style={{ ...btn, flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: space.xs }}
                        disabled={codegenBusy || !focusedRoot}
                        onClick={() => void requestCodegen("preview")}
                      >
                        <FileCode2 size={14} aria-hidden="true" /> Preview
                      </button>
                      <button
                        type="button"
                        style={{ ...btn, flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: space.xs }}
                        disabled={codegenBusy || !focusedRoot}
                        onClick={() => void requestCodegen("sync")}
                      >
                        <Save size={14} aria-hidden="true" /> Sync
                      </button>
                    </div>
                  </div>
                  {codegenError && (
                    <p style={{ color: color.amber, fontSize: text.sm, margin: 0 }}>
                      {codegenError}
                    </p>
                  )}
                  <div
                    style={{
                      border: `1px solid ${color.line}`,
                      borderRadius: radius.base,
                      background: color.chrome2,
                      padding: space.sm,
                      display: "flex",
                      flexDirection: "column",
                      gap: space.xs,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ color: color.ink, fontSize: text.sm }}>Repository</div>
                        <div style={{ color: color.inkFaint, fontSize: text.xs }}>
                          {gitLabel}
                        </div>
                        {repoPath && (
                          <div
                            title={repoPath}
                            style={{
                              color: color.inkFaint,
                              fontSize: text.xs,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {repoPath}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        title="Refresh Git status"
                        style={iconBtn}
                        onClick={() => void refreshGitStatus()}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                      </button>
                    </div>
                    {gitStatus.status === "ready" && !gitStatus.clean && (
                      <div style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
                        {gitStatus.files.slice(0, 8).map((file) => (
                          <div
                            key={`${file.index}${file.workingTree}-${file.path}`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: space.xs,
                              color: color.inkDim,
                              fontSize: text.xs,
                            }}
                          >
                            <span
                              style={{
                                flex: "0 0 auto",
                                color: color.inkFaint,
                                textTransform: "uppercase",
                              }}
                            >
                              {gitFileStatusLabel(file)}
                            </span>
                            <span
                              style={{
                                minWidth: 0,
                                flex: 1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={file.path}
                            >
                              {file.path}
                            </span>
                          </div>
                        ))}
                        {gitStatus.files.length > 8 && (
                          <div style={{ color: color.inkFaint, fontSize: text.xs }}>
                            +{gitStatus.files.length - 8} more
                          </div>
                        )}
                      </div>
                    )}
                    {gitStatus.status === "error" && (
                      <p style={{ margin: 0, color: color.amber, fontSize: text.xs }}>
                        {gitStatus.message}
                      </p>
                    )}
                  </div>
                  {codegenResult ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: space.sm, minHeight: 0 }}>
                      <p style={{ color: color.inkFaint, fontSize: text.xs, margin: 0 }}>
                        {codegenResult.wrote ? "Synced" : "Previewing"} {artifacts.length}{" "}
                        {artifacts.length === 1 ? "file" : "files"}.
                      </p>
                      <div style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
                        {artifacts.map((artifact) => {
                          const active = artifact.id === activeArtifact?.id;
                          const Icon = artifact.kind === "json" ? FileJson2 : FileCode2;
                          return (
                            <button
                              key={artifact.id}
                              type="button"
                              onClick={() => setActiveArtifactId(artifact.id)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: space.xs,
                                width: "100%",
                                border: `1px solid ${active ? color.accentLine : color.line}`,
                                borderRadius: radius.base,
                                background: active ? color.accentSoft : color.chrome2,
                                color: active ? color.accent : color.inkDim,
                                padding: `${space.xs} ${space.sm}`,
                                textAlign: "left",
                                fontSize: text.xs,
                              }}
                            >
                              <Icon size={14} aria-hidden="true" />
                              <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {artifact.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {activeArtifact && (
                        <div style={{ display: "flex", flexDirection: "column", minHeight: 260, flex: 1 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: space.xs,
                              border: `1px solid ${color.line}`,
                              borderBottom: 0,
                              borderRadius: `${radius.base} ${radius.base} 0 0`,
                              background: color.chrome2,
                              color: color.ink,
                              padding: `${space.xs} ${space.sm}`,
                              fontSize: text.xs,
                            }}
                          >
                            <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {activeArtifact.path}
                            </span>
                            <span style={{ color: color.inkFaint, textTransform: "uppercase" }}>
                              {activeArtifact.kind}
                            </span>
                          </div>
                          <pre
                            style={{
                              margin: 0,
                              flex: 1,
                              minHeight: 0,
                              padding: space.md,
                              background: color.canvas,
                              border: `1px solid ${color.line}`,
                              borderRadius: `0 0 ${radius.base} ${radius.base}`,
                              color: color.inkDim,
                              fontSize: text.xs,
                              lineHeight: 1.55,
                              overflow: "auto",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {activeArtifact.code}
                          </pre>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      style={{
                        border: `1px solid ${color.line}`,
                        borderRadius: radius.base,
                        background: color.chrome2,
                        color: color.inkFaint,
                        fontSize: text.sm,
                        padding: space.md,
                      }}
                    >
                      Preview or sync to inspect code-linked files.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
