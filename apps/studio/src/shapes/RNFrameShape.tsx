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
import { useDocumentStore } from "@rn-canvas/document";
import { RNFrameRenderer } from "@rn-canvas/render-web";

// Below this on-screen width the rnw detail isn't legible, so we render a cheap
// proxy instead of running Yoga + react-native-web. (PRD §7.2 LOD / §8: keep only a
// limited set of frames live; render the rest as lightweight proxies.)
const LOD_MIN_ONSCREEN_WIDTH = 160;

/** Lightweight stand-in for an off-focus / zoomed-out frame — no Yoga, no rnw. */
function LODProxy({ w, h, label }: { w: number; h: number; label: string }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f1f3f5",
        color: "#8b93a1",
        fontFamily: "sans-serif",
        fontSize: Math.max(12, Math.min(w, h) * 0.12),
      }}
    >
      {label}
    </div>
  );
}

/**
 * A tldraw shape that hosts one RN document subtree. tldraw owns the *spatial*
 * data (x/y/w/h/z); the shape only references a document root by id. The RN tree
 * is owned by the document store — the single source of truth — so editing a node
 * in the inspector re-renders here via the Zustand subscription.
 */
export type RNFrameShape = TLBaseShape<
  "rnframe",
  { w: number; h: number; rootId: string }
>;

// tldraw 5.1.1 types ShapeUtil's constraint as the closed builtin TLShape union,
// so a custom shape type isn't assignable here — custom shapes are nonetheless a
// supported runtime feature. The cast is isolated to this declaration.
// @ts-expect-error custom shape type vs closed TLShape constraint
export class RNFrameShapeUtil extends ShapeUtil<RNFrameShape> {
  static override type = "rnframe" as const;
  static override props: RecordProps<RNFrameShape> = {
    w: T.number,
    h: T.number,
    rootId: T.string,
  };

  override getDefaultProps(): RNFrameShape["props"] {
    return { w: 320, h: 120, rootId: "" };
  }

  override canResize() {
    return true;
  }

  override getGeometry(shape: RNFrameShape): Geometry2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: RNFrameShape) {
    const editor = useEditor();
    // Subscribe to just this frame's root; re-renders on any edit to its tree.
    const root = useDocumentStore((s) => s.roots[shape.props.rootId]);
    // A frame is "live" (full render) when selected or large enough on screen;
    // otherwise it falls back to the proxy. Reactive to zoom + selection.
    const live = useValue(
      "rnframe-live",
      () =>
        editor.getSelectedShapeIds().includes(shape.id) ||
        shape.props.w * editor.getZoomLevel() >= LOD_MIN_ONSCREEN_WIDTH,
      [editor, shape.id, shape.props.w],
    );
    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          overflow: "hidden",
          backgroundColor: "#ffffff",
          // Let tldraw handle selection/drag; inner RN content is preview-only.
          pointerEvents: "none",
        }}
      >
        {!root ? (
          <div style={{ padding: 12, color: "#999", fontSize: 12 }}>
            No document root ({shape.props.rootId || "unset"})
          </div>
        ) : live ? (
          <RNFrameRenderer root={root} />
        ) : (
          <LODProxy
            w={shape.props.w}
            h={shape.props.h}
            label={root.design?.name ?? root.type}
          />
        )}
      </HTMLContainer>
    );
  }

  override indicator(shape: RNFrameShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={4} />;
  }

  override getIndicatorPath(): undefined {
    // Fall back to the geometry-based indicator (we provide `indicator` above).
    return undefined;
  }
}
