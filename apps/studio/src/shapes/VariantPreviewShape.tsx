import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
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
import { FrameRenderer } from "@rn-canvas/render-web";
import { useShallow } from "zustand/react/shallow";
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
    if (!definition) {
      return (
        <HTMLContainer style={{ width: shape.props.w, height: shape.props.h }}>
          <div style={{ padding: 12, color: "#999", fontSize: 12 }}>
            Missing component ({shape.props.componentId || "unset"})
          </div>
        </HTMLContainer>
      );
    }

    const root = variantPreviewRoot(definition, shape.props.variantValues);
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
          backgroundColor: "#ffffff",
          border: `1px solid ${active ? color.accentLine : color.artLine}`,
          borderRadius: radius.base,
          boxShadow: active
            ? "0 0 0 3px rgba(59, 130, 246, 0.16), 0 10px 26px rgba(17, 24, 39, 0.11)"
            : "0 8px 24px rgba(17, 24, 39, 0.08)",
          pointerEvents: "auto",
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          setActiveVariantAll(shape.props.variantValues);
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
          <FrameRenderer root={root} components={components} />
        </div>
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
