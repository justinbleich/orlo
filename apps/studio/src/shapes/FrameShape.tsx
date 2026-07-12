import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  useEditor,
  useValue,
  type Editor,
  type Geometry2d,
  type RecordProps,
  type TLBaseShape,
} from "tldraw";
import { BatteryFull, Signal, Wifi } from "lucide-react";
import { useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  collectUsedComponentIds,
  findNode,
  useDocumentStore,
  type ComponentRegistry,
} from "@rn-canvas/document";
import {
  FrameRenderer,
  type LayoutReadyResult,
} from "@rn-canvas/render-web";
import { LayerOverlay } from "../LayerOverlay";
import { useStudioStore } from "../studio-store";
import { color, font, radius, text } from "../studio-theme";

// Below this on-screen width the rnw detail isn't legible, so we render a cheap
// proxy instead of running Yoga + react-native-web. (PRD §7.2 LOD / §8: keep only a
// limited set of frames live; render the rest as lightweight proxies.)
const LOD_MIN_ONSCREEN_WIDTH = 160;
const DEVICE_FRAME_RADIUS = 32;
const IOS_STATUS_BAR_HEIGHT = 54;

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

/** Non-exporting iOS preview chrome. It helps designers place content against
 * real device affordances without adding fake RN nodes to generated screens. */
function IOSDeviceChrome({ w, h }: { w: number; h: number }) {
  const sidePadding = Math.max(22, Math.min(34, w * 0.07));
  return (
    <div
      data-rn-device-chrome="ios"
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

/**
 * A tldraw shape that hosts one RN document subtree. tldraw owns the *spatial*
 * data (x/y/w/h/z); the shape only references a document root by id. The RN tree
 * is owned by the document store for the active Canvas projection, so editing a
 * node in the inspector re-renders here via the Zustand subscription.
 */
// The persisted tldraw shape type stays "rnframe" so existing tldraw stores
// keep loading after this rename. Only the TS symbols change.
export type FrameShape = TLBaseShape<
  "rnframe",
  { w: number; h: number; rootId: string }
>;
type UpdatePartial = Parameters<Editor["updateShape"]>[0];

// tldraw 5.1.1 types ShapeUtil's constraint as the closed builtin TLShape union,
// so a custom shape type isn't assignable here — custom shapes are nonetheless a
// supported runtime feature. The cast is isolated to this declaration.
// @ts-expect-error custom shape type vs closed TLShape constraint
export class FrameShapeUtil extends ShapeUtil<FrameShape> {
  static override type = "rnframe" as const;
  static override props: RecordProps<FrameShape> = {
    w: T.number,
    h: T.number,
    rootId: T.string,
  };

  override getDefaultProps(): FrameShape["props"] {
    return { w: 320, h: 120, rootId: "" };
  }

  override canResize() {
    return true;
  }

  // Translating a frame is a *document* action: the position lives in the store
  // (single undo history + canvas.json persistence); tldraw's own record is just
  // the live view. The whole drag is one interaction → one undo entry.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onTranslateStart(): any {
    try {
      useDocumentStore.getState().beginInteraction();
    } catch {
      /* an interaction may already be active (e.g. multi-frame drag) */
    }
    return undefined;
  }

  // Inner RN-node gestures belong to the document overlay. Even if tldraw's
  // capture listener also observes the pointer, never translate the host frame
  // while its document selection is inside the root.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onTranslate(initial: FrameShape, current: FrameShape): any {
    const store = useDocumentStore.getState();
    const root = store.roots[current.props.rootId];
    const hasInnerSelection =
      !!root && store.selection.some((id) => id !== root.id && !!findNode(root, id));
    if (hasInnerSelection) {
      return {
        id: current.id,
        type: current.type,
        x: initial.x,
        y: initial.y,
      };
    }
    store.setFramePosition(current.props.rootId, current.x, current.y);
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onTranslateEnd(initial: FrameShape, current: FrameShape): any {
    const store = useDocumentStore.getState();
    store.setFramePosition(current.props.rootId, current.x, current.y);
    store.commitInteraction();
    return undefined;
  }

  // Resizing the frame is resizing the *screen*: the new box size is written to
  // the root node's width/height so Yoga reflows the content (responsive, like a
  // device). The whole drag is one document interaction → one undo entry; the
  // App-side reconcile mirrors the shape box back from the root on undo.
  // tldraw is untyped in this build, so these handlers are loosely typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onResizeStart(shape: FrameShape): any {
    try {
      useDocumentStore.getState().beginInteraction();
    } catch {
      /* an interaction may already be active; resize still applies */
    }
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onResize(shape: FrameShape, info: any): any {
    const w = Math.max(40, Math.round(info.initialShape.props.w * info.scaleX));
    const h = Math.max(40, Math.round(info.initialShape.props.h * info.scaleY));
    const { rootId } = shape.props;
    try {
      useDocumentStore.getState().updateStyle(rootId, rootId, { width: w, height: h });
    } catch {
      /* transient invalid size during drag — keep the last valid layout */
    }
    return {
      id: shape.id,
      type: shape.type,
      x: info.newPoint.x,
      y: info.newPoint.y,
      props: { ...shape.props, w, h },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onResizeEnd(): any {
    useDocumentStore.getState().commitInteraction();
    return undefined;
  }

  override getGeometry(shape: FrameShape): Geometry2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: FrameShape) {
    const editor = useEditor();
    const [layoutResult, setLayoutResult] = useState<LayoutReadyResult | null>(null);
    const setStudioLayout = useStudioStore((state) => state.setLayout);
    // While a creation tool or component is armed, every frame becomes a live drop
    // target — the cursor (not a prior selection) picks which screen receives it.
    const armed = useStudioStore(
      (state) => state.armedTool !== null || state.armedComponentId !== null,
    );
    const onLayoutReady = useCallback((result: LayoutReadyResult) => {
      setLayoutResult(result);
      setStudioLayout(shape.props.rootId, result);

      // Screen roots own an explicit device frame, but component templates are
      // often intentionally unconstrained (for example a promoted node that was
      // positioned with left/right on its screen). In component focus mode the
      // generic frame fallback must not masquerade as part of the component.
      // Fit the tldraw host to Yoga's resolved template bounds instead.
      const editing = useDocumentStore.getState().editingComponentId === shape.props.rootId;
      if (!editing) return;
      const w = Number.isFinite(result.width) && result.width > 0 ? result.width : shape.props.w;
      const h = Number.isFinite(result.height) && result.height > 0 ? result.height : shape.props.h;
      if (Math.abs(w - shape.props.w) <= 0.01 && Math.abs(h - shape.props.h) <= 0.01) return;
      editor.run(
        () => {
          editor.updateShape({
            id: shape.id,
            type: shape.type,
            props: { ...shape.props, w, h },
          } as unknown as UpdatePartial);
        },
        { history: "ignore", ignoreShapeLock: true },
      );
    }, [editor, setStudioLayout, shape.id, shape.props, shape.props.rootId]);
    // Subscribe to just this frame's root; re-renders on any edit to its tree.
    const root = useDocumentStore((s) => s.roots[shape.props.rootId]);
    const editingComponentId = useDocumentStore((s) => s.editingComponentId);
    // Selection collapses to one boolean here, so selecting nodes in another
    // frame doesn't re-render (or re-layout) this one.
    const hasInnerSelection = useDocumentStore((s) => {
      const tree = s.roots[shape.props.rootId];
      return !!tree && s.selection.some((id) => id !== tree.id && !!findNode(tree, id));
    });
    // Only the definitions this frame's tree actually uses (transitively), plus
    // this frame's own definition while it hosts a component edit. Editing an
    // unrelated component no longer re-expands and re-layouts every frame.
    const components = useDocumentStore(
      useShallow((s): ComponentRegistry => {
        const tree = s.roots[shape.props.rootId];
        const out: ComponentRegistry = {};
        if (!tree) return out;
        for (const id of collectUsedComponentIds(tree, s.components)) {
          const definition = s.components[id];
          if (definition) out[id] = definition;
        }
        const own = s.components[shape.props.rootId];
        if (own) out[shape.props.rootId] = own;
        return out;
      }),
    );
    const outOfFocus = !!editingComponentId && shape.props.rootId !== editingComponentId;
    const editingDefinition =
      editingComponentId === shape.props.rootId ? components[shape.props.rootId] : undefined;
    // A frame is "live" (full render) when selected or large enough on screen;
    // otherwise it falls back to the proxy. Reactive to zoom + selection.
    const selected = useValue(
      "rnframe-selected",
      () => editor.getSelectedShapeIds().includes(shape.id),
      [editor, shape.id],
    );
    const largeEnough = useValue(
      "rnframe-large-enough",
      () => shape.props.w * editor.getZoomLevel() >= LOD_MIN_ONSCREEN_WIDTH,
      [editor, shape.id, shape.props.w],
    );
    const live = selected || largeEnough || hasInnerSelection;
    // The overlay owns pointer input when its frame is selected, or for any frame
    // while a tool is armed (so you can draw into an unselected screen directly).
    const interactive = !outOfFocus && (selected || hasInnerSelection || armed);
    return (
      <HTMLContainer
        data-rn-root-id={shape.props.rootId}
        style={{
          position: "relative",
          width: shape.props.w,
          height: shape.props.h,
          overflow: editingDefinition ? "visible" : "hidden",
          backgroundColor: editingDefinition ? "transparent" : "#ffffff",
          border: editingDefinition
            ? "none"
            : `1px solid ${hasInnerSelection ? "transparent" : color.artLine}`,
          borderRadius: editingDefinition ? 0 : DEVICE_FRAME_RADIUS,
          boxShadow:
            editingDefinition || hasInnerSelection
              ? "none"
              : "0 8px 24px rgba(17, 24, 39, 0.08)",
          opacity: outOfFocus ? 0 : 1,
          // Let tldraw handle selection/drag; inner RN content is preview-only.
          pointerEvents: interactive ? "auto" : "none",
        }}
      >
        {!root ? (
          <div style={{ padding: 12, color: "#999", fontSize: 12 }}>
            No document root ({shape.props.rootId || "unset"})
          </div>
        ) : live ? (
          <div style={{ pointerEvents: "none" }}>
            <FrameRenderer root={root} components={components} onLayoutReady={onLayoutReady} />
          </div>
        ) : (
          <LODProxy
            w={shape.props.w}
            h={shape.props.h}
            label={root.design?.name ?? root.type}
          />
        )}
        {root && live && !editingDefinition && (
          <IOSDeviceChrome w={shape.props.w} h={shape.props.h} />
        )}
        {root && live && layoutResult && (
          <LayerOverlay root={root} result={layoutResult} active={interactive} />
        )}
        {editingDefinition && !outOfFocus && live && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: -28,
              maxWidth: shape.props.w,
              borderRadius: radius.sm,
              border: `1px solid ${color.accentLine}`,
              background: color.accentSoft,
              color: color.accent,
              padding: "3px 8px",
              fontFamily: font.sans,
              fontSize: text["2xs"],
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              pointerEvents: "none",
            }}
          >
            Base
          </div>
        )}
      </HTMLContainer>
    );
  }

  override indicator(shape: FrameShape) {
    const store = useDocumentStore.getState();
    const root = store.roots[shape.props.rootId];
    const hasInnerSelection =
      !!root && store.selection.some((id) => id !== root.id && !!findNode(root, id));
    if (hasInnerSelection) return null;
    return <rect width={shape.props.w} height={shape.props.h} rx={DEVICE_FRAME_RADIUS} />;
  }

  override getIndicatorPath(): undefined {
    // Fall back to the geometry-based indicator (we provide `indicator` above).
    return undefined;
  }
}
