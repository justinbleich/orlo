import { BatteryFull, Signal, Wifi } from "lucide-react";
import { useState, type PointerEvent } from "react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  useEditor,
  useValue,
  type Geometry2d,
  type RecordProps,
  type TLBaseShape,
} from "tldraw";
import {
  collectUsedComponentIds,
  useDocumentStore,
  type ComponentRegistry,
} from "@rn-canvas/document";
import { useShallow } from "zustand/react/shallow";
import { FrameRenderer, type LayoutBox, type LayoutReadyResult } from "@rn-canvas/render-web";
import { color, font, radius, text } from "../studio-theme";
import { useWorkspaceStore } from "../workspace-store";

const LOD_MIN_ONSCREEN_WIDTH = 150;
const DEVICE_FRAME_RADIUS = 28;
const IOS_STATUS_BAR_HEIGHT = 54;

export type FlowScreenShape = TLBaseShape<
  "rnflowscreen",
  { w: number; h: number; rootId: string; flowId: string }
>;

let openFlowScreen: (rootId: string) => void = () => {};
let startFlowAnchorDrag: (
  flowId: string,
  rootId: string,
  anchorNodeId: string,
  event: PointerEvent<HTMLButtonElement>,
) => void = () => {};

export function registerFlowScreenOpenHandler(handler: (rootId: string) => void) {
  openFlowScreen = handler;
  return () => {
    if (openFlowScreen === handler) openFlowScreen = () => {};
  };
}

export function registerFlowAnchorDragHandler(
  handler: (
    flowId: string,
    rootId: string,
    anchorNodeId: string,
    event: PointerEvent<HTMLButtonElement>,
  ) => void,
) {
  startFlowAnchorDrag = handler;
  return () => {
    if (startFlowAnchorDrag === handler) startFlowAnchorDrag = () => {};
  };
}

function flattenLayout(box: LayoutBox, out: LayoutBox[] = []) {
  if (box.node.design?.hidden) return out;
  out.push(box);
  for (const child of box.children) flattenLayout(child, out);
  return out;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function LODProxy({ w, h, label }: { w: number; h: number; label: string }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: color.art2,
        color: color.artDim,
        fontFamily: font.sans,
        fontSize: Math.max(12, Math.min(w, h) * 0.12),
      }}
    >
      {label}
    </div>
  );
}

function IOSDeviceChrome({ w, h }: { w: number; h: number }) {
  const sidePadding = Math.max(22, Math.min(34, w * 0.07));
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        borderRadius: DEVICE_FRAME_RADIUS,
        color: color.artInk,
        fontFamily: font.sans,
        pointerEvents: "none",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: sidePadding,
          right: sidePadding,
          top: 0,
          height: IOS_STATUS_BAR_HEIGHT,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 0,
        }}
      >
        <span>9:41</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Signal size={15} strokeWidth={2.8} aria-hidden="true" />
          <Wifi size={15} strokeWidth={2.8} aria-hidden="true" />
          <BatteryFull size={23} strokeWidth={2.2} aria-hidden="true" />
        </span>
      </div>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: w / 2 - 67,
          bottom: Math.max(8, Math.min(12, h * 0.015)),
          width: 134,
          height: 5,
          borderRadius: 999,
          background: color.artInk,
          opacity: 0.86,
        }}
      />
    </div>
  );
}

// @ts-expect-error custom shape type vs closed TLShape constraint
export class FlowScreenShapeUtil extends ShapeUtil<FlowScreenShape> {
  static override type = "rnflowscreen" as const;
  static override props: RecordProps<FlowScreenShape> = {
    w: T.number,
    h: T.number,
    rootId: T.string,
    flowId: T.string,
  };

  override getDefaultProps(): FlowScreenShape["props"] {
    return { w: 320, h: 120, rootId: "", flowId: "" };
  }

  override canResize() {
    return false;
  }

  override onTranslate(_initial: FlowScreenShape, current: FlowScreenShape) {
    useWorkspaceStore
      .getState()
      .setFlowPosition(current.props.flowId, current.props.rootId, current.x, current.y);
    return undefined;
  }

  override onTranslateEnd(_initial: FlowScreenShape, current: FlowScreenShape) {
    useWorkspaceStore
      .getState()
      .setFlowPosition(current.props.flowId, current.props.rootId, current.x, current.y);
    return undefined;
  }

  override onDoubleClick(shape: FlowScreenShape) {
    openFlowScreen(shape.props.rootId);
    return undefined;
  }

  override getGeometry(shape: FlowScreenShape): Geometry2d {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override component(shape: FlowScreenShape) {
    const editor = useEditor();
    const root = useDocumentStore((s) => s.roots[shape.props.rootId]);
    const [layoutResult, setLayoutResult] = useState<LayoutReadyResult | null>(null);
    const [hoveredAnchorId, setHoveredAnchorId] = useState<string | null>(null);
    const flowWireMode = useWorkspaceStore((s) => s.flowWireMode);
    const wiredAnchorIds = useWorkspaceStore(
      useShallow((s) => {
        const flow = s.flowsById[shape.props.flowId];
        return new Set(
          (flow?.edges ?? [])
            .filter((edge) => edge.from.rootId === shape.props.rootId && edge.from.anchorNodeId)
            .map((edge) => edge.from.anchorNodeId as string),
        );
      }),
    );
    const components = useDocumentStore(
      useShallow((s): ComponentRegistry => {
        const tree = s.roots[shape.props.rootId];
        const out: ComponentRegistry = {};
        if (!tree) return out;
        for (const id of collectUsedComponentIds(tree, s.components)) {
          const definition = s.components[id];
          if (definition) out[id] = definition;
        }
        return out;
      }),
    );
    const selected = useValue(
      "rnflowscreen-selected",
      () => editor.getSelectedShapeIds().includes(shape.id),
      [editor, shape.id],
    );
    const largeEnough = useValue(
      "rnflowscreen-large-enough",
      () => shape.props.w * editor.getZoomLevel() >= LOD_MIN_ONSCREEN_WIDTH,
      [editor, shape.id, shape.props.w],
    );
    const zoomLevel = useValue("rnflowscreen-zoom-level", () => editor.getZoomLevel(), [editor]);
    const live = selected || largeEnough;
    const showUnusedAnchors = selected || flowWireMode;
    const inverseZoom = 1 / Math.max(0.05, zoomLevel);
    const screenPx = (value: number) => value * inverseZoom;
    return (
      <HTMLContainer
        data-flow-root-id={shape.props.rootId}
        style={{
          position: "relative",
          width: shape.props.w,
          height: shape.props.h,
          overflow: "hidden",
          backgroundColor: "#ffffff",
          border: `1px solid ${selected ? color.accentLine : color.artLine}`,
          borderRadius: DEVICE_FRAME_RADIUS,
          boxShadow: selected
            ? "0 0 0 3px rgba(59, 130, 246, 0.16), 0 10px 26px rgba(17, 24, 39, 0.11)"
            : "0 8px 24px rgba(17, 24, 39, 0.08)",
          pointerEvents: "none",
        }}
      >
        {!root ? (
          <div style={{ padding: 12, color: "#999", fontSize: 12 }}>
            No document root ({shape.props.rootId || "unset"})
          </div>
        ) : live ? (
          <div style={{ pointerEvents: "none" }}>
            <FrameRenderer root={root} components={components} onLayoutReady={setLayoutResult} />
          </div>
        ) : (
          <LODProxy w={shape.props.w} h={shape.props.h} label={root.design?.name ?? root.type} />
        )}
        {root && live && <IOSDeviceChrome w={shape.props.w} h={shape.props.h} />}
        {root &&
          live &&
          layoutResult &&
          flattenLayout(layoutResult.layout)
            .filter((box) => box.node.id !== root.id)
            .filter((box) => wiredAnchorIds.has(box.node.id) || showUnusedAnchors)
            .map((box) => {
              const wired = wiredAnchorIds.has(box.node.id);
              const label = box.node.design?.name ?? box.node.type;
              const hovered = hoveredAnchorId === box.node.id;
              const anchorWidth = Math.max(screenPx(36), box.width);
              const anchorHeight = Math.max(screenPx(22), box.height);
              const anchorBorder = screenPx(2);
              const nubSize = screenPx(wired || hovered ? 16 : 12);
              const labelHeight = screenPx(20);
              const labelTop =
                box.top > screenPx(24) ? box.top - labelHeight - screenPx(4) : box.top + screenPx(4);
              const labelLeft = clamp(box.left, screenPx(4), shape.props.w - screenPx(168));
              return (
                <button
                  key={box.instanceKey}
                  type="button"
                  data-flow-anchor-id={box.node.id}
                  data-flow-anchor-state={wired ? "wired" : "available"}
                  className="flow-anchor"
                  title={wired ? `Wired from ${label}` : `Connect from ${label}`}
                  aria-label={wired ? `Wired from ${label}` : `Connect from ${label}`}
                  onPointerDown={(event) => startFlowAnchorDrag(shape.props.flowId, root.id, box.node.id, event)}
                  onPointerEnter={() => setHoveredAnchorId(box.node.id)}
                  onPointerLeave={() => setHoveredAnchorId((current) => (current === box.node.id ? null : current))}
                  onMouseEnter={() => setHoveredAnchorId(box.node.id)}
                  onMouseLeave={() => setHoveredAnchorId((current) => (current === box.node.id ? null : current))}
                  style={{
                    position: "absolute",
                    left: box.left,
                    top: box.top,
                    width: anchorWidth,
                    height: anchorHeight,
                    borderRadius: Math.min(screenPx(10), Math.max(screenPx(4), Math.min(anchorWidth, anchorHeight) * 0.18)),
                    border: `${anchorBorder}px solid ${
                      wired || hovered ? color.accent : color.accentLine
                    }`,
                    background: wired
                      ? "rgba(59, 130, 246, 0.08)"
                      : hovered
                        ? "rgba(59, 130, 246, 0.06)"
                      : "rgba(59, 130, 246, 0.025)",
                    boxShadow: wired
                      ? "0 0 0 4px rgba(59, 130, 246, 0.14), 0 3px 12px rgba(17, 24, 39, 0.2)"
                      : hovered
                        ? "0 0 0 3px rgba(59, 130, 246, 0.1), 0 2px 8px rgba(17, 24, 39, 0.14)"
                        : "0 0 0 2px rgba(59, 130, 246, 0.08)",
                    opacity: wired || hovered ? 1 : 0.9,
                    pointerEvents: "auto",
                    cursor: "crosshair",
                    padding: 0,
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="flow-anchor-label"
                    data-flow-anchor-label={box.node.id}
                    style={{
                      position: "absolute",
                      left: labelLeft - box.left,
                      top: labelTop - box.top,
                      maxWidth: screenPx(160),
                      minHeight: labelHeight,
                      display: "flex",
                      alignItems: "center",
                      padding: `0 ${screenPx(7)}px`,
                      borderRadius: screenPx(Number.parseFloat(radius.xs) || 4),
                      background: color.accent,
                      border: `${screenPx(1)}px solid ${color.accent}`,
                      boxShadow: "var(--shadow-control)",
                      color: color.chrome,
                      fontFamily: font.sans,
                      fontSize: screenPx(Number.parseFloat(text["2xs"]) || 10),
                      fontWeight: 700,
                      lineHeight: `${screenPx(14)}px`,
                      overflow: "hidden",
                      pointerEvents: "none",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      right: -nubSize / 2,
                      top: "50%",
                      width: nubSize,
                      height: nubSize,
                      transform: "translateY(-50%)",
                      borderRadius: 999,
                      border: `${anchorBorder}px solid ${wired || hovered ? color.accent : color.accentLine}`,
                      background: wired ? color.accent : color.chrome,
                      boxShadow: "0 2px 8px rgba(17, 24, 39, 0.2)",
                    }}
                  />
                </button>
              );
            })}
      </HTMLContainer>
    );
  }

  override indicator(shape: FlowScreenShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={DEVICE_FRAME_RADIUS} />;
  }

  override getIndicatorPath(): undefined {
    return undefined;
  }
}
