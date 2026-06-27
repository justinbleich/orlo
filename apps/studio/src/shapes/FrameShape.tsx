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
import { useCallback, useMemo, useState } from "react";
import {
  applyOverrides,
  createInstance,
  findNode,
  resolveVariant,
  useDocumentStore,
  type ComponentDefinition,
  type ComponentRegistry,
  type Node,
} from "@rn-canvas/document";
import {
  FrameRenderer,
  type LayoutReadyResult,
} from "@rn-canvas/render-web";
import { LayerOverlay } from "../LayerOverlay";
import { useStudioStore } from "../studio-store";

// Below this on-screen width the rnw detail isn't legible, so we render a cheap
// proxy instead of running Yoga + react-native-web. (PRD §7.2 LOD / §8: keep only a
// limited set of frames live; render the rest as lightweight proxies.)
const LOD_MIN_ONSCREEN_WIDTH = 160;
const MAX_VARIANT_PREVIEWS = 12;

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

function variantPreviewCombinations(
  definition: ComponentDefinition,
): Record<string, string>[] {
  const axes = (definition.variants ?? []).filter((axis) => axis.values.length > 0);
  let combos: Record<string, string>[] = [{}];
  for (const axis of axes) {
    combos = combos.flatMap((combo) =>
      axis.values.map((value) => ({ ...combo, [axis.name]: value })),
    );
  }
  return combos;
}

function variantPreviewKey(
  definition: ComponentDefinition,
  values: Record<string, string>,
): string {
  return (definition.variants ?? [])
    .filter((axis) => axis.values.length > 0)
    .map((axis) => `${axis.name}:${values[axis.name]}`)
    .join("|");
}

function variantPreviewLabel(
  definition: ComponentDefinition,
  values: Record<string, string>,
): string {
  const axes = (definition.variants ?? []).filter((axis) => axis.values.length > 0);
  const base = axes.every((axis) => values[axis.name] === axis.values[0]);
  if (base) return "Base";
  return axes.map((axis) => values[axis.name]).join(" / ");
}

function variantPreviewRoot(
  definition: ComponentDefinition,
  values: Record<string, string>,
): Node {
  const key = variantPreviewKey(definition, values).replace(/[^A-Za-z0-9_-]/g, "_");
  return applyOverrides(definition, {
    ...createInstance(definition.id, { id: `${definition.id}-preview-${key}` }),
    variant: values,
  });
}

function ComponentVariantWorkspace({
  definition,
  activeVariant,
  components,
  activeWidth,
  activeHeight,
}: {
  definition: ComponentDefinition;
  activeVariant: Record<string, string> | undefined;
  components: ComponentRegistry;
  activeWidth: number;
  activeHeight: number;
}) {
  const setActiveVariant = useStudioStore((state) => state.setActiveVariant);
  const axes = (definition.variants ?? []).filter((axis) => axis.values.length > 0);
  const combos = useMemo(() => variantPreviewCombinations(definition), [definition]);
  if (axes.length === 0 || combos.length <= 1) return null;

  const resolved = resolveVariant(definition, activeVariant);
  const activeKey = variantPreviewKey(definition, resolved);
  const previewCombos = combos.slice(0, MAX_VARIANT_PREVIEWS);
  const hiddenCount = Math.max(0, combos.length - previewCombos.length);
  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: activeWidth + 32,
    top: 0,
    width: Math.max(260, Math.min(520, activeWidth * 1.6)),
    maxHeight: Math.max(320, activeHeight),
    overflow: "auto",
    padding: 12,
    borderRadius: 8,
    border: "1px solid rgba(148, 163, 184, 0.24)",
    background: "rgba(19, 23, 32, 0.96)",
    boxShadow: "0 18px 40px rgba(0, 0, 0, 0.28)",
    color: "#cbd5e1",
    fontFamily: "Inter, sans-serif",
    pointerEvents: "auto",
  };

  return (
    <div style={baseStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ color: "#f8fafc", fontSize: 12, fontWeight: 600 }}>
          {definition.name} variants
        </div>
        <div style={{ marginLeft: "auto", color: "#94a3b8", fontSize: 10 }}>
          {combos.length} states
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 10,
        }}
      >
        {previewCombos.map((values) => {
          const key = variantPreviewKey(definition, values);
          const active = key === activeKey;
          const previewRoot = variantPreviewRoot(definition, values);
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                for (const axis of axes) setActiveVariant(axis.name, values[axis.name]);
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                minWidth: 0,
                padding: 8,
                borderRadius: 6,
                border: `1px solid ${active ? "#7c83ff" : "rgba(148, 163, 184, 0.24)"}`,
                background: active ? "rgba(124, 131, 255, 0.16)" : "rgba(255, 255, 255, 0.03)",
                color: active ? "#aeb4ff" : "#cbd5e1",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                {variantPreviewLabel(definition, values)}
              </span>
              <span
                style={{
                  display: "block",
                  height: 84,
                  overflow: "hidden",
                  borderRadius: 4,
                  background: "#ffffff",
                  pointerEvents: "none",
                }}
              >
                <span
                  style={{
                    display: "block",
                    transform: "scale(0.5)",
                    transformOrigin: "top left",
                    width: "200%",
                    height: "200%",
                  }}
                >
                  <FrameRenderer root={previewRoot} components={components} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {hiddenCount > 0 && (
        <div style={{ marginTop: 10, color: "#94a3b8", fontSize: 10 }}>
          {hiddenCount} more states hidden for performance
        </div>
      )}
    </div>
  );
}

/**
 * A tldraw shape that hosts one RN document subtree. tldraw owns the *spatial*
 * data (x/y/w/h/z); the shape only references a document root by id. The RN tree
 * is owned by the document store — the single source of truth — so editing a node
 * in the inspector re-renders here via the Zustand subscription.
 */
// The persisted tldraw shape type stays "rnframe" so existing tldraw stores
// keep loading after this rename. Only the TS symbols change.
export type FrameShape = TLBaseShape<
  "rnframe",
  { w: number; h: number; rootId: string }
>;

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

  // Inner RN-node gestures belong to the document overlay. Even if tldraw's
  // capture listener also observes the pointer, never translate the host frame
  // while its document selection is inside the root.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onTranslate(initial: FrameShape, current: FrameShape): any {
    const store = useDocumentStore.getState();
    const root = store.roots[current.props.rootId];
    const hasInnerSelection =
      !!root && store.selection.some((id) => id !== root.id && !!findNode(root, id));
    if (!hasInnerSelection) return undefined;
    return {
      id: current.id,
      type: current.type,
      x: initial.x,
      y: initial.y,
    };
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
    }, [setStudioLayout, shape.props.rootId]);
    // Subscribe to just this frame's root; re-renders on any edit to its tree.
    const root = useDocumentStore((s) => s.roots[shape.props.rootId]);
    const editingComponentId = useDocumentStore((s) => s.editingComponentId);
    // The component registry expands any instances in this frame to primitives.
    const components = useDocumentStore((s) => s.components);
    const activeVariant = useStudioStore((state) => state.activeVariant);
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
    const live = selected || largeEnough;
    // The overlay owns pointer input when its frame is selected, or for any frame
    // while a tool is armed (so you can draw into an unselected screen directly).
    const interactive = !outOfFocus && (selected || armed);
    return (
      <HTMLContainer
        data-rn-root-id={shape.props.rootId}
        style={{
          width: shape.props.w,
          height: shape.props.h,
          overflow: editingDefinition ? "visible" : "hidden",
          backgroundColor: "#ffffff",
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
        {root && live && layoutResult && (
          <LayerOverlay root={root} result={layoutResult} active={interactive} />
        )}
        {editingDefinition && !outOfFocus && live && (
          <ComponentVariantWorkspace
            definition={editingDefinition}
            activeVariant={activeVariant}
            components={components}
            activeWidth={shape.props.w}
            activeHeight={shape.props.h}
          />
        )}
      </HTMLContainer>
    );
  }

  override indicator(shape: FrameShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={4} />;
  }

  override getIndicatorPath(): undefined {
    // Fall back to the geometry-based indicator (we provide `indicator` above).
    return undefined;
  }
}
