import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Tldraw,
  createShapeId,
  useEditor,
  useValue,
  type Editor,
  type TLComponents,
  type TLUiOverrides,
} from "tldraw";
import "tldraw/tldraw.css";
import { MousePointerClick, Plus, Route, ZoomIn, ZoomOut } from "lucide-react";
import { useDocumentStore, type Node, type NodeId } from "@rn-canvas/document";
import { flowGraphLayers } from "./flow-model";
import {
  FlowScreenShapeUtil,
  registerFlowAnchorDragHandler,
  registerFlowScreenOpenHandler,
  type FlowScreenShape,
} from "./shapes/FlowScreenShape";
import { IconButton, IconToggle, cn } from "./studio-ui";
import { color } from "./studio-theme";
import { useWorkspaceStore, type FlowDefinition } from "./workspace-store";
import type { FlowEdge } from "./repo-contract";

const shapeUtils = [FlowScreenShapeUtil];
const FLOW_SCREEN_TYPE = FlowScreenShapeUtil.type;
const KEEP_TOOLS = new Set(["select", "hand", "zoom"]);
const FLOW_GAP_X = 520;
const FLOW_GAP_Y = 980;
const FLOW_ORIGIN = { x: 120, y: 120 };

type EditorShape = ReturnType<Editor["getCurrentPageShapes"]>[number];
type CreatePartial = Parameters<Editor["createShape"]>[0];
type UpdatePartial = Parameters<Editor["updateShape"]>[0];

const isFlowScreen = (shape: EditorShape) => (shape.type as string) === FLOW_SCREEN_TYPE;
const asFlowScreen = (shape: EditorShape) => shape as unknown as FlowScreenShape;

const flowComponentsBase: TLComponents = {
  Toolbar: null,
  MainMenu: null,
  StylePanel: null,
  PageMenu: null,
  ActionsMenu: null,
  QuickActions: null,
  HelpMenu: null,
  ZoomMenu: null,
  KeyboardShortcutsDialog: null,
  DebugMenu: null,
  DebugPanel: null,
};

const flowOverrides: TLUiOverrides = {
  tools(_editor, tools) {
    for (const id of Object.keys(tools)) {
      if (!KEEP_TOOLS.has(id)) delete tools[id];
    }
    return tools;
  },
};

function rootSize(root: Node): { w: number; h: number } {
  const w = typeof root.style.width === "number" ? root.style.width : 390;
  const h = typeof root.style.height === "number" ? root.style.height : 844;
  return { w, h };
}

function defaultPositions(flow: FlowDefinition, routeScreens: readonly Node[]) {
  const layers = flowGraphLayers(flow.entryRootId, flow.edges, routeScreens.map((root) => root.id));
  const byRoot = new Map(routeScreens.map((root) => [root.id, root]));
  const positions: Record<NodeId, { x: number; y: number }> = {};
  for (const layer of layers) {
    const column = layer.depth;
    const roots = layer.rootIds.filter((rootId) => byRoot.has(rootId));
    roots.forEach((rootId, row) => {
      positions[rootId] = {
        x: FLOW_ORIGIN.x + column * FLOW_GAP_X,
        y: FLOW_ORIGIN.y + row * FLOW_GAP_Y,
      };
    });
  }
  routeScreens.forEach((root, index) => {
    positions[root.id] ??= {
      x: FLOW_ORIGIN.x + index * FLOW_GAP_X,
      y: FLOW_ORIGIN.y,
    };
  });
  return positions;
}

function syncFlowShapes(
  editor: Editor,
  flow: FlowDefinition,
  routeScreens: readonly Node[],
  storedPositions: Record<string, { x: number; y: number }> | undefined,
) {
  const screenById = new Map(routeScreens.map((root) => [root.id, root]));
  const defaults = defaultPositions(flow, routeScreens);
  const existing = new Map(
    editor
      .getCurrentPageShapes()
      .filter(isFlowScreen)
      .map((shape) => [asFlowScreen(shape).props.rootId, asFlowScreen(shape)]),
  );

  for (const shape of editor.getCurrentPageShapes()) {
    if (!isFlowScreen(shape)) continue;
    const flowShape = asFlowScreen(shape);
    if (flowShape.props.flowId !== flow.id || !screenById.has(flowShape.props.rootId)) {
      editor.deleteShapes([shape.id]);
    }
  }

  for (const root of routeScreens) {
    const { w, h } = rootSize(root);
    const position = storedPositions?.[root.id] ?? defaults[root.id] ?? FLOW_ORIGIN;
    const existingShape = existing.get(root.id);
    if (existingShape) {
      if (
        existingShape.props.flowId !== flow.id ||
        existingShape.props.w !== w ||
        existingShape.props.h !== h ||
        Math.abs(existingShape.x - position.x) > 0.01 ||
        Math.abs(existingShape.y - position.y) > 0.01
      ) {
        editor.updateShape({
          id: existingShape.id,
          type: FLOW_SCREEN_TYPE,
          x: position.x,
          y: position.y,
          props: { flowId: flow.id, rootId: root.id, w, h },
        } as unknown as UpdatePartial);
      }
      continue;
    }
    editor.createShape({
      id: createShapeId(),
      type: FLOW_SCREEN_TYPE,
      x: position.x,
      y: position.y,
      props: { flowId: flow.id, rootId: root.id, w, h },
    } as unknown as CreatePartial);
    if (!storedPositions?.[root.id]) {
      useWorkspaceStore.getState().setFlowPosition(flow.id, root.id, position.x, position.y);
    }
  }
}

function elbowPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const midX = from.x + Math.max(72, (to.x - from.x) / 2);
  return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
}

function flowAnchorPagePoint(
  editor: Editor,
  edge: FlowEdge,
  source: FlowScreenShape,
): { x: number; y: number } {
  const anchorNodeId = edge.from.anchorNodeId;
  if (!anchorNodeId) {
    return { x: source.x + source.props.w, y: source.y + source.props.h / 2 };
  }
  const anchor = document.querySelector<HTMLElement>(
    `[data-flow-anchor-id="${CSS.escape(anchorNodeId)}"][data-flow-root-id="${CSS.escape(edge.from.rootId)}"]`,
  );
  if (!anchor) {
    return { x: source.x + source.props.w, y: source.y + source.props.h / 2 };
  }
  const rect = anchor.getBoundingClientRect();
  return editor.screenToPage({ x: rect.right, y: rect.top + rect.height / 2 });
}

function flowEdgeKey(edge: FlowEdge) {
  return [
    edge.from.rootId,
    edge.from.anchorNodeId ?? "",
    edge.to,
    edge.kind,
    edge.condition ?? "",
  ].join("|");
}

function FlowEdgesOverlay({ flow }: { flow: FlowDefinition }) {
  const editor = useEditor();
  const addStoredFlowEdge = useWorkspaceStore((s) => s.addFlowEdge);
  const removeStoredFlowEdge = useWorkspaceStore((s) => s.removeFlowEdge);
  const setStatus = useWorkspaceStore((s) => s.setStatus);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    fromRootId: NodeId;
    anchorNodeId?: NodeId;
    startPage: { x: number; y: number };
    x: number;
    y: number;
  } | null>(null);
  const shapeMap = useValue(
    "flow-screen-shapes",
    () => {
      const entries = editor
        .getCurrentPageShapes()
        .filter(isFlowScreen)
        .map((shape) => [asFlowScreen(shape).props.rootId, asFlowScreen(shape)] as const);
      return new Map(entries);
    },
    [editor],
  );

  const connectorEdges = flow.edges.length > 0 ? flow.edges : [];
  const findTargetAtClientPoint = useCallback(
    (fromRootId: NodeId, clientX: number, clientY: number) => {
      const point = editor.screenToPage({ x: clientX, y: clientY });
      return [...shapeMap.values()].find(
        (shape) =>
          shape.props.rootId !== fromRootId &&
          point.x >= shape.x &&
          point.x <= shape.x + shape.props.w &&
          point.y >= shape.y &&
          point.y <= shape.y + shape.props.h,
      );
    },
    [editor, shapeMap],
  );
  const commitEdge = useCallback(
    (fromRootId: NodeId, clientX: number, clientY: number, anchorNodeId?: NodeId) => {
      const target = findTargetAtClientPoint(fromRootId, clientX, clientY);
      if (!target) {
        setStatus("Drop on another screen to create a flow connection");
        return;
      }
      const edge: FlowEdge = {
        from: { rootId: fromRootId, anchorNodeId },
        to: target.props.rootId,
        kind: "primary",
      };
      void addStoredFlowEdge(flow.id, edge).then(
        () => setStatus("Added flow edge"),
        (error) => setStatus(error instanceof Error ? error.message : "Flow edge save failed"),
      );
    },
    [addStoredFlowEdge, findTargetAtClientPoint, flow.id, setStatus],
  );

  useEffect(
    () =>
      registerFlowAnchorDragHandler((flowId, rootId, anchorNodeId, event) => {
        if (flowId !== flow.id) return;
        event.preventDefault();
        event.stopPropagation();
        setDrag({
          fromRootId: rootId,
          anchorNodeId,
          startPage: editor.screenToPage({ x: event.clientX, y: event.clientY }),
          x: event.clientX,
          y: event.clientY,
        });
      }),
    [editor, flow.id],
  );

  useEffect(() => {
    if (!drag) return undefined;
    const onPointerMove = (event: PointerEvent) => {
      setDrag((current) => (current ? { ...current, x: event.clientX, y: event.clientY } : current));
    };
    const onPointerUp = (event: PointerEvent) => {
      commitEdge(drag.fromRootId, event.clientX, event.clientY, drag.anchorNodeId);
      setDrag(null);
    };
    const onPointerCancel = () => setDrag(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", onPointerCancel, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [commitEdge, drag]);

  const dragTarget = drag ? findTargetAtClientPoint(drag.fromRootId, drag.x, drag.y) : undefined;

  const deleteEdge = useCallback(
    (edge: FlowEdge) => {
      setSelectedEdgeKey(null);
      void removeStoredFlowEdge(flow.id, edge).then(
        () => setStatus(edge.from.anchorNodeId ? "Removed wire; source screen re-syncing" : "Removed flow edge"),
        (error) => setStatus(error instanceof Error ? error.message : "Flow edge removal failed"),
      );
    },
    [flow.id, removeStoredFlowEdge, setStatus],
  );

  // Escape clears the wire selection; Delete/Backspace removes the selected wire.
  useEffect(() => {
    if (!selectedEdgeKey) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedEdgeKey(null);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        // Never eat the keystroke while the user is typing — the capture-phase
        // listener fires before the field would, so Backspace in a rename or
        // condition input must not delete the selected wire.
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable)
        ) {
          return;
        }
        const edge = flow.edges.find((candidate) => flowEdgeKey(candidate) === selectedEdgeKey);
        if (edge) {
          event.preventDefault();
          deleteEdge(edge);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [deleteEdge, flow.edges, selectedEdgeKey]);

  return (
    <>
      <svg
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
          pointerEvents: "none",
        }}
      >
        <defs>
          <marker
            id="flow-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
          </marker>
        </defs>
        {connectorEdges.map((edge, index) => {
          const source = shapeMap.get(edge.from.rootId);
          const target = shapeMap.get(edge.to);
          if (!source || !target) return null;
          const from = flowAnchorPagePoint(editor, edge, source);
          const to = { x: target.x, y: target.y + target.props.h / 2 };
          const dashed = edge.kind !== "primary";
          const key = flowEdgeKey(edge);
          const selected = key === selectedEdgeKey;
          const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
          return (
            <g key={`${key}-${index}`}>
              <path
                d={elbowPath(from, to)}
                fill="none"
                stroke={
                  selected
                    ? "var(--amber, #C77B27)"
                    : edge.kind === "fallback"
                      ? "var(--ink-faint)"
                      : "var(--accent)"
                }
                strokeWidth={selected ? 4 : 3}
                strokeDasharray={dashed ? "10 9" : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
                markerEnd="url(#flow-arrow)"
                opacity={selected ? 1 : 0.84}
              />
              {/* Fat invisible twin so the wire is clickable (parent svg is inert). */}
              <path
                d={elbowPath(from, to)}
                fill="none"
                stroke="transparent"
                strokeWidth={18}
                style={{ pointerEvents: "stroke", cursor: "pointer" }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setSelectedEdgeKey((current) => (current === key ? null : key));
                }}
              />
              {selected && (
                <g
                  role="button"
                  aria-label="Delete flow wire"
                  style={{ pointerEvents: "all", cursor: "pointer" }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    deleteEdge(edge);
                  }}
                >
                  <circle
                    cx={mid.x}
                    cy={mid.y}
                    r={13}
                    fill="var(--chrome, #fff)"
                    stroke="var(--amber, #C77B27)"
                    strokeWidth={2}
                  />
                  <path
                    d={`M ${mid.x - 5} ${mid.y - 5} L ${mid.x + 5} ${mid.y + 5} M ${mid.x + 5} ${mid.y - 5} L ${mid.x - 5} ${mid.y + 5}`}
                    stroke="var(--amber, #C77B27)"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                </g>
              )}
            </g>
          );
        })}
        {drag && (
          <path
            d={elbowPath(
              drag.startPage,
              editor.screenToPage({ x: drag.x, y: drag.y }),
            )}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={3}
            strokeDasharray="8 8"
            strokeLinecap="round"
            opacity={0.55}
          />
        )}
        {dragTarget && (
          <rect
            x={dragTarget.x - 12}
            y={dragTarget.y - 12}
            width={dragTarget.props.w + 24}
            height={dragTarget.props.h + 24}
            rx={34}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={4}
            strokeDasharray="12 10"
            opacity={0.7}
          />
        )}
      </svg>
      {[...shapeMap.values()].map((shape) => (
        <button
          key={shape.id}
          type="button"
          title="Drag to connect"
          aria-label="Drag to connect"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            setDrag({
              fromRootId: shape.props.rootId,
              startPage: { x: shape.x + shape.props.w, y: shape.y + shape.props.h / 2 },
              x: event.clientX,
              y: event.clientY,
            });
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            setDrag((current) =>
              current
                ? { ...current, x: event.clientX, y: event.clientY }
                : {
                    fromRootId: shape.props.rootId,
                    startPage: { x: shape.x + shape.props.w, y: shape.y + shape.props.h / 2 },
                    x: event.clientX,
                    y: event.clientY,
                  },
            );
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            commitEdge(shape.props.rootId, event.clientX, event.clientY);
            setDrag(null);
          }}
          onPointerCancel={() => setDrag(null)}
          style={{
            position: "absolute",
            left: shape.x + shape.props.w - 10,
            top: shape.y + shape.props.h / 2 - 10,
            width: 20,
            height: 20,
            borderRadius: 999,
            border: `2px solid ${color.accent}`,
            background: color.chrome,
            boxShadow: "0 3px 10px rgba(17, 24, 39, 0.18)",
            pointerEvents: "auto",
            cursor: "crosshair",
          }}
        />
      ))}
      {drag && (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          onPointerMove={(event) =>
            setDrag((current) =>
              current ? { ...current, x: event.clientX, y: event.clientY } : current,
            )
          }
          onPointerUp={(event) => {
            commitEdge(drag.fromRootId, event.clientX, event.clientY, drag.anchorNodeId);
            setDrag(null);
          }}
          onPointerCancel={() => setDrag(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            cursor: "crosshair",
            opacity: 0,
            pointerEvents: "auto",
          }}
        />
      )}
    </>
  );
}

export function FlowCanvas({
  flow,
  routeScreens,
  onSelectScreen,
}: {
  flow: FlowDefinition;
  routeScreens: Node[];
  onSelectScreen: (rootId: NodeId) => void;
}) {
  const editorRef = useRef<Editor | null>(null);
  const storedPositions = useWorkspaceStore((s) => s.flowPositions[flow.id]);
  const flowWireMode = useWorkspaceStore((s) => s.flowWireMode);
  const setFlowWireMode = useWorkspaceStore((s) => s.setFlowWireMode);
  const [ready, setReady] = useState(false);
  const components = useMemo<TLComponents>(
    () => ({
      ...flowComponentsBase,
      OnTheCanvas: () => <FlowEdgesOverlay flow={flow} />,
    }),
    [flow],
  );

  const fitFlow = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const bounds = editor.getCurrentPageShapes()
      .filter(isFlowScreen)
      .map((shape) => editor.getShapePageBounds(shape))
      .filter((bounds): bounds is NonNullable<typeof bounds> => !!bounds);
    if (bounds.length === 0) return;
    const minX = Math.min(...bounds.map((box) => box.x));
    const minY = Math.min(...bounds.map((box) => box.y));
    const maxX = Math.max(...bounds.map((box) => box.x + box.w));
    const maxY = Math.max(...bounds.map((box) => box.y + box.h));
    editor.zoomToBounds(
      { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      { inset: 120, animation: { duration: 180 } },
    );
  }, []);

  const onMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      editor.user.updateUserPreferences({ colorScheme: "light" });
      editor.updateInstanceState({ isGridMode: true });
      syncFlowShapes(editor, flow, routeScreens, storedPositions);
      setReady(true);
      requestAnimationFrame(fitFlow);
    },
    [fitFlow, flow, routeScreens, storedPositions],
  );

  useEffect(() => registerFlowScreenOpenHandler(onSelectScreen), [onSelectScreen]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !ready) return;
    editor.run(
      () => syncFlowShapes(editor, flow, routeScreens, storedPositions),
      { history: "ignore", ignoreShapeLock: true },
    );
  }, [flow, ready, routeScreens, storedPositions]);

  return (
    <div className="relative h-full min-h-0 flex-1" data-testid="flow-canvas">
      <Tldraw
        onMount={onMount}
        shapeUtils={shapeUtils}
        components={components}
        overrides={flowOverrides}
      />
      <div className="studio-chrome absolute right-md top-md z-10 flex items-center gap-xs rounded-sm border border-line bg-chrome p-xs shadow-control">
        <IconToggle title="Show connect handles" pressed={flowWireMode} onPressedChange={setFlowWireMode}>
          <MousePointerClick size={14} aria-hidden="true" />
        </IconToggle>
        <IconButton title="Fit flow" onClick={fitFlow}>
          <Route size={14} aria-hidden="true" />
        </IconButton>
        <IconButton title="Zoom in" onClick={() => editorRef.current?.zoomIn()}>
          <ZoomIn size={14} aria-hidden="true" />
        </IconButton>
        <IconButton title="Zoom out" onClick={() => editorRef.current?.zoomOut()}>
          <ZoomOut size={14} aria-hidden="true" />
        </IconButton>
      </div>
      {routeScreens.length === 0 && (
        <div className={cn("pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-faint")}>
          <div className="flex items-center gap-xs rounded-sm border border-line bg-chrome px-md py-sm shadow-control">
            <Plus size={14} aria-hidden="true" />
            Add a screen to start mapping the flow.
          </div>
        </div>
      )}
    </div>
  );
}
