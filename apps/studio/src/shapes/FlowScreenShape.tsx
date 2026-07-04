import { BatteryFull, Signal, Wifi } from "lucide-react";
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
import { FrameRenderer } from "@rn-canvas/render-web";
import { color, font } from "../studio-theme";
import { useWorkspaceStore } from "../workspace-store";

const LOD_MIN_ONSCREEN_WIDTH = 150;
const DEVICE_FRAME_RADIUS = 28;
const IOS_STATUS_BAR_HEIGHT = 54;

export type FlowScreenShape = TLBaseShape<
  "rnflowscreen",
  { w: number; h: number; rootId: string; flowId: string }
>;

let openFlowScreen: (rootId: string) => void = () => {};

export function registerFlowScreenOpenHandler(handler: (rootId: string) => void) {
  openFlowScreen = handler;
  return () => {
    if (openFlowScreen === handler) openFlowScreen = () => {};
  };
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
    const live = selected || largeEnough;
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
            <FrameRenderer root={root} components={components} />
          </div>
        ) : (
          <LODProxy w={shape.props.w} h={shape.props.h} label={root.design?.name ?? root.type} />
        )}
        {root && live && <IOSDeviceChrome w={shape.props.w} h={shape.props.h} />}
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
