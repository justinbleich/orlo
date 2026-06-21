import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  findRootContaining,
  sampleDocument,
  useDocumentStore,
  type Node,
  type NodeId,
} from "@rn-canvas/document";
import {
  RNFrameRenderer,
  computePixelDiff,
  registerAndDiff,
} from "@rn-canvas/render-web";
import { toPng } from "html-to-image";
import { RNFrameShapeUtil, type RNFrameShape } from "./shapes/RNFrameShape";
import { Inspector } from "./Inspector";
import { color, layout, radius, space, text } from "./studio-theme";
import { Eyebrow, GroundTruthPane, LeftPanel, Tabs, ToolRail } from "./shell";

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
// be made. RN primitives are document nodes created via the inspector, never here.
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

function rootSize(root: Node): { w: number; h: number } {
  const w = typeof root.style.width === "number" ? root.style.width : 320;
  const h = typeof root.style.height === "number" ? root.style.height : 200;
  return { w, h };
}

/** Create a tldraw shape for any document root that doesn't have one yet. */
function syncShapes(editor: Editor) {
  const { roots } = useDocumentStore.getState();
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

function loadImageData(url: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

export default function App() {
  const editorRef = useRef<Editor | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  // Fidelity-diff state (preserved from the Phase 0 workflow).
  const [simUrl, setSimUrl] = useState<string | null>(null);
  const [diffScore, setDiffScore] = useState<number | null>(null);
  const [status, setStatus] = useState("Frame: drag · Resize: handles · Add: tool rail");
  const [busy, setBusy] = useState(false);
  const [inspectorTab, setInspectorTab] = useState("Design");

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
  const undo = useDocumentStore((s) => s.undo);
  const redo = useDocumentStore((s) => s.redo);

  const onMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
    // Dark canvas to match the studio shell (chrome theming, not artboard).
    editor.user.updateUserPreferences({ colorScheme: "dark" });

    const store = useDocumentStore.getState();
    if (Object.keys(store.roots).length === 0) {
      store.addRoot(sampleDocument);
    }
    syncShapes(editor);
    store.setSelection([sampleDocument.id]);

    // Canvas → store: selecting a frame selects its root node (unless the current
    // selection already lives in that frame, e.g. a child node is selected).
    editor.store.listen(
      () => {
        const sel = editor.getOnlySelectedShape();
        if (!sel || !isRNFrame(sel)) return;
        const rootId = asRNFrame(sel).props.rootId;
        const s = useDocumentStore.getState();
        const curRoot = findRootContaining(Object.values(s.roots), s.selection[0] ?? "");
        if (curRoot?.id !== rootId) s.setSelection([rootId]);
      },
      { scope: "session" },
    );
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

  // Reconcile shapes with roots: add shapes for new roots, prune shapes whose root
  // is gone (e.g. undo of Add frame), and mirror design.locked → shape lock.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    syncShapes(editor);
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
    const editor = editorRef.current;
    if (editor) syncShapes(editor);
    store.setSelection([root.id]);
  }, []);

  const captureCanvas = useCallback(async () => {
    if (!captureRef.current) return null;
    return toPng(captureRef.current, { pixelRatio: 2, cacheBust: true });
  }, []);

  const captureSim = useCallback(async () => {
    setBusy(true);
    setStatus("Capturing iOS simulator screenshot…");
    try {
      const res = await fetch("/api/sim-screenshot");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setSimUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setStatus("Simulator screenshot captured.");
      return url;
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Simulator capture failed");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const runDiff = useCallback(async () => {
    setBusy(true);
    setStatus("Running visual diff…");
    try {
      const canvas = await captureCanvas();
      const sim = simUrl ?? (await captureSim());
      if (!canvas || !sim) {
        setStatus("Need both canvas and simulator screenshots for diff.");
        return;
      }
      const [a, b] = await Promise.all([loadImageData(canvas), loadImageData(sim)]);
      const result = registerAndDiff(a, b, computePixelDiff);
      setDiffScore(result.score);
      setStatus(
        `Fidelity (card-registered): ${(result.score * 100).toFixed(1)}% over ${result.width}×${result.height}`,
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Diff failed");
    } finally {
      setBusy(false);
    }
  }, [captureCanvas, captureSim, simUrl]);

  const btn: React.CSSProperties = {
    background: color.chrome2,
    color: color.ink,
    border: `1px solid ${color.line}`,
    borderRadius: radius.base,
    padding: `${space.xs} ${space.md}`,
    fontSize: text.sm,
  };
  // Top-bar placeholders (structure only; controls fill in across phases).
  const crumbStyle: React.CSSProperties = { color: color.inkDim, fontSize: text.base };
  const placeholderChip: React.CSSProperties = {
    ...btn,
    color: color.inkDim,
    background: "transparent",
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: color.canvas,
      }}
    >
      {/* TOP BAR */}
      <header
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
        <span style={crumbStyle}>Untitled · Phase 2</span>
        <div style={{ display: "flex", gap: space.xs }}>
          <button
            type="button"
            style={btn}
            disabled={!canUndo}
            onClick={() => undo()}
            title="Undo"
          >
            ↶
          </button>
          <button
            type="button"
            style={btn}
            disabled={!canRedo}
            onClick={() => redo()}
            title="Redo"
          >
            ↷
          </button>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: space.sm }}>
          <span style={{ ...crumbStyle, fontSize: text.sm }}>100%</span>
          <span style={{ display: "flex", alignItems: "center", gap: space.xs, ...crumbStyle, fontSize: text.sm }}>
            <span
              style={{ width: 8, height: 8, borderRadius: radius.pill, background: color.accent }}
            />
            Agent idle
          </span>
          <button type="button" style={placeholderChip} disabled title="Phase 4">
            Run on device
          </button>
          <button type="button" style={placeholderChip} disabled title="Phase 3">
            Export
          </button>
          <span
            title="Account"
            style={{
              width: 26,
              height: 26,
              borderRadius: radius.pill,
              background: color.raised,
              border: `1px solid ${color.line}`,
            }}
          />
        </div>
      </header>

      {/* WORKBENCH: rail · left panel · canvas · right column */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <ToolRail onAddFrame={addFrame} />
        <LeftPanel />

        <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
            <Tldraw
              onMount={onMount}
              shapeUtils={shapeUtils}
              components={components}
              overrides={overrides}
            />
          </div>
          <div
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

        {/* RIGHT COLUMN: inspector (top) + ground-truth pane (bottom) */}
        <div
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
                <div style={{ padding: space.md }}>
                  <Eyebrow>Code</Eyebrow>
                  <p style={{ color: color.inkFaint, fontSize: text.sm }}>
                    Generated RN code — BUILD Phase 3 (codegen).
                  </p>
                </div>
              )}
            </div>
          </div>

          <GroundTruthPane
            toolbar={
              <div style={{ display: "flex", gap: space.sm }}>
                <button type="button" style={btn} disabled={busy} onClick={() => void captureSim()}>
                  Capture simulator
                </button>
                <button type="button" style={btn} disabled={busy} onClick={() => void runDiff()}>
                  Run diff{diffScore !== null ? ` · ${(diffScore * 100).toFixed(0)}%` : ""}
                </button>
              </div>
            }
          >
            {simUrl ? (
              <img
                src={simUrl}
                alt="Simulator screenshot"
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            ) : (
              <span style={{ color: color.inkFaint, fontSize: text.sm, textAlign: "center", padding: space.md }}>
                Live simulator mirror — BUILD Phase 4. Use Capture simulator to diff
                the focused frame.
              </span>
            )}
          </GroundTruthPane>
        </div>
      </div>

      {/* Offscreen capture target: a clean render of the focused frame for the
          fidelity diff (the simulator is ground truth; this is preview-only). */}
      <div style={{ position: "fixed", left: -10000, top: 0 }} aria-hidden>
        <div ref={captureRef} data-frame-root>
          {focusedRoot ? <RNFrameRenderer root={focusedRoot} /> : null}
        </div>
      </div>
    </div>
  );
}
