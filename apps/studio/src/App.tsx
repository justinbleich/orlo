import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Redo2, Undo2 } from "lucide-react";
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
  sampleDocument,
  useDocumentStore,
  type Node,
  type NodeId,
  type RNPrimitive,
} from "@rn-canvas/document";
import { RNFrameShapeUtil, type RNFrameShape } from "./shapes/RNFrameShape";
import { Inspector } from "./Inspector";
import { color, layout, radius, space, text } from "./studio-theme";
import { Eyebrow, LeftPanel, Tabs, ToolRail } from "./shell";
import { deleteNodes, duplicateNodes, reorderNode } from "./document-actions";
import { startMcpBridge } from "./mcp-bridge";
import { handleMcpCommand } from "./mcp-command-handler";
import { normalizeNodeSelection } from "./selection";

const shapeUtils = [RNFrameShapeUtil];
const RNFRAME = RNFrameShapeUtil.type;

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

// tldraw's shape vocabulary is RNFrame only. Keep navigation tools (select, hand,
// zoom); remove every shape-creating/destructive tool so no tldraw-native shape can
// be made. RN primitives are document nodes created via the tool rail (draw-to-create).
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
const isRNFrame = (s: EditorShape) => (s.type as string) === RNFRAME;
const asRNFrame = (s: EditorShape) => s as unknown as RNFrameShape;
type CreatePartial = Parameters<Editor["createShape"]>[0];
type UpdatePartial = Parameters<Editor["updateShape"]>[0];

type CodegenResult = {
  screenName: string;
  code: string;
  sidecar: string;
  targetPath: string;
  sidecarPath: string;
  wrote?: boolean;
};

type OpenDocumentResult = {
  version: 1;
  screenName: string;
  root: Node;
  targetPath: string;
  sidecarPath: string;
};

type ImportSourceResult = {
  screenName: string;
  root: Node;
  sourcePath: string;
  sidecarPath: string;
};

function rootSize(root: Node): { w: number; h: number } {
  const w = typeof root.style.width === "number" ? root.style.width : 320;
  const h = typeof root.style.height === "number" ? root.style.height : 200;
  return { w, h };
}

/** Create a tldraw shape for any document root that doesn't have one yet. */
function createMissingShapes(editor: Editor, roots: Record<NodeId, Node>) {
  const existing = new Set(
    editor
      .getCurrentPageShapes()
      .filter(isRNFrame)
      .map((s) => asRNFrame(s).props.rootId),
  );
  let i = existing.size;
  for (const root of Object.values(roots)) {
    if (existing.has(root.id)) continue;
    const { w, h } = rootSize(root);
    editor.createShape({
      id: createShapeId(),
      type: RNFRAME,
      x: 80 + (i % 3) * 380,
      y: 80 + Math.floor(i / 3) * 320,
      props: { rootId: root.id, w, h },
      isLocked: !!root.design?.locked,
    } as unknown as CreatePartial);
    i += 1;
  }
}

/** RNFrame records derive from document roots, so reconciliation must never
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
    .filter(isRNFrame)
    .map((shape) => {
      const frame = asRNFrame(shape);
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

  const [status, setStatus] = useState("Frame: drag · Resize: handles · Add: tool rail");
  const [inspectorTab, setInspectorTab] = useState("Design");
  const [screenName, setScreenName] = useState("Screen");
  const [targetPath, setTargetPath] = useState("generated/Screen.tsx");
  const [sidecarPath, setSidecarPath] = useState("generated/Screen.rncanvas.json");
  const [codegenResult, setCodegenResult] = useState<CodegenResult | null>(null);
  const [codegenError, setCodegenError] = useState<string | null>(null);
  const [codegenBusy, setCodegenBusy] = useState(false);
  const [canvasCanUndo, setCanvasCanUndo] = useState(false);
  const [canvasCanRedo, setCanvasCanRedo] = useState(false);

  // The document store's selection is the single source of truth. The focused
  // frame is *derived* from it (the root whose subtree holds the selection), and
  // canvas selection is kept in sync with it below — neither side owns its own copy.
  const roots = useDocumentStore((s) => s.roots);
  const selection = useDocumentStore((s) => s.selection);
  const focusedRoot = useMemo(
    () => findRootContaining(Object.values(roots), selection[0] ?? ""),
    [roots, selection],
  );
  const focusedRootId = focusedRoot?.id ?? null;

  const canUndo = useDocumentStore((s) => s.past.length > 0);
  const canRedo = useDocumentStore((s) => s.future.length > 0);
  const hasActiveInteraction = useDocumentStore((s) => !!s.interaction);
  const undo = useDocumentStore((s) => s.undo);
  const redo = useDocumentStore((s) => s.redo);

  useEffect(() => startMcpBridge(handleMcpCommand), []);

  const onMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
    // Dark canvas to match the studio shell (chrome theming, not artboard).
    editor.user.updateUserPreferences({ colorScheme: "dark" });

    const store = useDocumentStore.getState();
    if (Object.keys(store.roots).length === 0) {
      store.loadRoots({ [sampleDocument.id]: sampleDocument }, [sampleDocument.id]);
    }
    syncShapes(editor);
    if (store.selection.length === 0) store.setSelection(Object.keys(store.roots).slice(0, 1));

    // Canvas → store: selecting a frame selects its root node (unless the current
    // selection already lives in that frame, e.g. a child node is selected).
    editor.store.listen(
      () => {
        if (reconcilingShapesRef.current) return;
        const sel = editor.getOnlySelectedShape();
        if (!sel || !isRNFrame(sel)) return;
        const rootId = asRNFrame(sel).props.rootId;
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
      .find((s) => isRNFrame(s) && asRNFrame(s).props.rootId === focusedRoot.id);
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
          setStatus(`Duplicated ${nodeIds.length} layer${nodeIds.length > 1 ? "s" : ""}`);
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
        setStatus(`Deleted ${nodeIds.length} layer${nodeIds.length > 1 ? "s" : ""}`);
        return;
      }

      const editor = editorRef.current;
      if (!editor) return;
      const selectedRootIds = editor
        .getSelectedShapes()
        .filter(isRNFrame)
        .map((shape) => asRNFrame(shape).props.rootId)
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
            if (!isRNFrame(shape)) continue;
            const root = roots[asRNFrame(shape).props.rootId];
            if (!root) {
              editor.deleteShapes([shape.id]);
              continue;
            }
            const shouldLock = !!root.design?.locked;
            if (shape.isLocked !== shouldLock) {
              editor.updateShape({
                id: shape.id,
                type: RNFRAME,
                isLocked: shouldLock,
              } as unknown as UpdatePartial);
            }
            // Mirror the screen size from the root so a document undo of a frame
            // resize restores the box too. Only when it differs (a live drag has
            // already matched them, so this won't fight tldraw mid-gesture).
            const frame = asRNFrame(shape);
            const { w, h } = rootSize(root);
            if (frame.props.w !== w || frame.props.h !== h) {
              editor.updateShape({
                id: shape.id,
                type: RNFRAME,
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
                    isRNFrame(shape) && asRNFrame(shape).props.rootId === selectedRoot.id,
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
    const root = createNode("View", {
      style: {
        width: 220,
        height: 160,
        padding: 16,
        backgroundColor: "#ffffff",
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "#dddddd",
        justifyContent: "center",
        alignItems: "center",
      },
      children: [createNode("Text", { props: { text: "New frame" } })],
    });
    const store = useDocumentStore.getState();
    store.addRoot(root);
    store.setSelection([root.id]);
  }, []);

  const selectTool = useCallback(() => {
    editorRef.current?.setCurrentTool("select");
    setStatus("Select tool active");
  }, []);

  const requestCodegen = useCallback(
    async (mode: "preview" | "sync") => {
      if (!focusedRoot) {
        setCodegenError("Select a frame before syncing code.");
        return null;
      }
      setCodegenBusy(true);
      setCodegenError(null);
      try {
        const res = await fetch(`/api/codegen/${mode}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ root: focusedRoot, screenName, targetPath }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setCodegenResult(body);
        setStatus(
          mode === "sync"
            ? `Synced ${body.targetPath} + ${body.sidecarPath}`
            : `Generated preview for ${body.targetPath}`,
        );
        return body as CodegenResult;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Codegen failed";
        setCodegenError(message);
        setStatus(message);
        return null;
      } finally {
        setCodegenBusy(false);
      }
    },
    [focusedRoot, screenName, targetPath],
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
      useDocumentStore.getState().loadRoots(
        { [opened.root.id]: opened.root },
        [opened.root.id],
      );
      resetCanvasHistory();
      setScreenName(opened.screenName);
      setTargetPath(opened.targetPath);
      setSidecarPath(opened.sidecarPath);
      setCodegenResult(null);
      setStatus(`Opened ${opened.sidecarPath}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sidecar load failed";
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
      useDocumentStore.getState().loadRoots(
        { [imported.root.id]: imported.root },
        [imported.root.id],
      );
      resetCanvasHistory();
      setScreenName(imported.screenName);
      setTargetPath(imported.sourcePath);
      setSidecarPath(imported.sidecarPath);
      setCodegenResult(null);
      setStatus(`Imported ${imported.sourcePath}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "React Native import failed";
      setCodegenError(message);
      setStatus(message);
    } finally {
      setCodegenBusy(false);
    }
  }, [resetCanvasHistory, targetPath]);

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
          <button
            type="button"
            style={btn}
            disabled={codegenBusy || !focusedRoot}
            title="Write generated RN + sidecar to the workspace"
            onClick={() => void requestCodegen("sync")}
          >
            Sync Code
          </button>
        </div>
      </header>

      {/* WORKBENCH: rail · left panel · canvas · right column */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <ToolRail
          onSelect={selectTool}
          onAddFrame={addFrame}
          canAddPrimitive={!!focusedRoot}
        />
        <LeftPanel onAddFrame={addFrame} />

        <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
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
                <Inspector rootId={focusedRootId} />
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
                  <label style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
                    <span style={{ color: color.inkDim, fontSize: text.xs }}>
                      Sidecar path (.rncanvas.json)
                    </span>
                    <input
                      value={sidecarPath}
                      onChange={(e) => setSidecarPath(e.target.value)}
                      style={fieldStyle}
                    />
                  </label>
                  <button
                    type="button"
                    style={btn}
                    disabled={codegenBusy}
                    onClick={() => void openSidecar()}
                  >
                    Open Sidecar
                  </button>
                  <label style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
                    <span style={{ color: color.inkDim, fontSize: text.xs }}>Screen name</span>
                    <input
                      value={screenName}
                      onChange={(e) => setScreenName(e.target.value)}
                      onBlur={() => void requestCodegen("preview")}
                      style={fieldStyle}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
                    <span style={{ color: color.inkDim, fontSize: text.xs }}>
                      Repo path (.tsx)
                    </span>
                    <input
                      value={targetPath}
                      onChange={(e) => setTargetPath(e.target.value)}
                      style={fieldStyle}
                    />
                  </label>
                  <button
                    type="button"
                    style={btn}
                    disabled={codegenBusy}
                    onClick={() => void importSource()}
                  >
                    Import RN Source
                  </button>
                  <div style={{ display: "flex", gap: space.sm }}>
                    <button
                      type="button"
                      style={btn}
                      disabled={codegenBusy || !focusedRoot}
                      onClick={() => void requestCodegen("preview")}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      style={btn}
                      disabled={codegenBusy || !focusedRoot}
                      onClick={() => void requestCodegen("sync")}
                    >
                      Sync Code
                    </button>
                  </div>
                  {codegenError && (
                    <p style={{ color: color.amber, fontSize: text.sm, margin: 0 }}>
                      {codegenError}
                    </p>
                  )}
                  {codegenResult && (
                    <>
                      <p style={{ color: color.inkFaint, fontSize: text.sm, margin: 0 }}>
                        {codegenResult.wrote ? "Wrote" : "Previewing"}{" "}
                        {codegenResult.targetPath} + {codegenResult.sidecarPath}. Git is
                        explicit: review and commit these files yourself.
                      </p>
                      <pre
                        style={{
                          margin: 0,
                          padding: space.md,
                          background: color.canvas,
                          border: `1px solid ${color.line}`,
                          borderRadius: radius.base,
                          color: color.inkDim,
                          fontSize: text.xs,
                          lineHeight: 1.55,
                          overflow: "auto",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {codegenResult.code}
                      </pre>
                    </>
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
