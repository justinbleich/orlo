import { useCallback, useMemo, useState } from "react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  useEditor,
  type Editor,
  type Geometry2d,
  type RecordProps,
  type TLBaseShape,
} from "tldraw";
import {
  collectUsedComponentIds,
  resolveVariant,
  useDocumentStore,
  type ComponentRegistry,
} from "@rn-canvas/document";
import { FrameRenderer, type LayoutReadyResult } from "@rn-canvas/render-web";
import { useShallow } from "zustand/react/shallow";
import { LayerOverlay } from "../LayerOverlay";
import { color, font, radius, space, text } from "../studio-theme";
import { useStudioStore } from "../studio-store";
import {
  variantPreviewKey,
  variantPreviewLabel,
  variantPreviewRoot,
} from "../variant-workspace";

export type VariantPreviewShape = TLBaseShape<
  "rnvariantpreview",
  { componentId: string; variantValues: Record<string, string>; w: number; h: number }
>;
type UpdatePartial = Parameters<Editor["updateShape"]>[0];

// @ts-expect-error custom shape type vs closed TLShape constraint
export class VariantPreviewShapeUtil extends ShapeUtil<VariantPreviewShape> {
  static override type = "rnvariantpreview" as const;
  static override props: RecordProps<VariantPreviewShape> = {
    componentId: T.string,
    variantValues: T.dict(T.string, T.string),
    w: T.number,
    h: T.number,
  };

  override getDefaultProps(): VariantPreviewShape["props"] {
    return { componentId: "", variantValues: {}, w: 320, h: 120 };
  }

  override canResize() {
    return false;
  }

  override getGeometry(shape: VariantPreviewShape): Geometry2d {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override component(shape: VariantPreviewShape) {
    const editor = useEditor();
    const definition = useDocumentStore((s) => s.components[shape.props.componentId]);
    const activeVariant = useStudioStore((s) => s.activeVariant);
    const setActiveVariantAll = useStudioStore((s) => s.setActiveVariantAll);
    const components = useDocumentStore(
      useShallow((s): ComponentRegistry => {
        const definition = s.components[shape.props.componentId];
        const out: ComponentRegistry = {};
        if (!definition) return out;
        const previewRoot = variantPreviewRoot(definition, shape.props.variantValues);
        for (const id of collectUsedComponentIds(previewRoot, s.components)) {
          const used = s.components[id];
          if (used) out[id] = used;
        }
        return out;
      }),
    );
    // Layout snapshot for direct manipulation — shape-local, unlike FrameShape's
    // rootId-keyed studio layout map (a preview isn't a document root).
    const [layoutResult, setLayoutResult] = useState<LayoutReadyResult | null>(null);
    const onLayoutReady = useCallback(
      (result: LayoutReadyResult) => {
        setLayoutResult(result);
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
      },
      [editor, shape.id, shape.props],
    );
    const root = useMemo(
      () => (definition ? variantPreviewRoot(definition, shape.props.variantValues) : null),
      [definition, shape.props.variantValues],
    );
    if (!definition || !root) {
      return (
        <HTMLContainer style={{ width: shape.props.w, height: shape.props.h }}>
          <div style={{ padding: 12, color: "#999", fontSize: 12 }}>
            Missing component ({shape.props.componentId || "unset"})
          </div>
        </HTMLContainer>
      );
    }

    const activeKey = variantPreviewKey(definition, resolveVariant(definition, activeVariant));
    const ownKey = variantPreviewKey(definition, shape.props.variantValues);
    const active = activeKey === ownKey;

    return (
      <HTMLContainer
        data-rn-variant-component-id={shape.props.componentId}
        style={{
          position: "relative",
          width: shape.props.w,
          height: shape.props.h,
          overflow: "visible",
          // The component paints its own surface. Preview chrome must not add a
          // second white card behind it (especially visible for transparent or
          // rounded components).
          backgroundColor: "transparent",
          border: "none",
          borderRadius: 0,
          boxShadow: "none",
          pointerEvents: "auto",
        }}
        onPointerDownCapture={() => {
          // Capture phase: fires before the overlay's handlers (which stop
          // propagation), so touching a preview always activates its combo.
          setActiveVariantAll(shape.props.variantValues);
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: -28,
            maxWidth: shape.props.w,
            display: "flex",
            alignItems: "center",
            gap: space.xs,
            borderRadius: radius.sm,
            border: `1px solid ${active ? color.accentLine : color.line}`,
            background: active ? color.accentSoft : color.chrome,
            color: active ? color.accent : color.inkDim,
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
          {variantPreviewLabel(definition, shape.props.variantValues)}
        </div>
        <div style={{ pointerEvents: "none" }}>
          <FrameRenderer root={root} components={components} onLayoutReady={onLayoutReady} />
        </div>
        {/* Direct manipulation: active only while this combo is the active
            variant — first click activates (capture handler above), then the
            overlay owns selection/drag/resize, routing writes into this
            combination's overrides. */}
        {layoutResult && (
          <LayerOverlay
            root={root}
            result={layoutResult}
            active
            variantTarget={{
              componentId: shape.props.componentId,
              values: shape.props.variantValues,
            }}
          />
        )}
      </HTMLContainer>
    );
  }

  override indicator(shape: VariantPreviewShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override getIndicatorPath(): undefined {
    return undefined;
  }
}
