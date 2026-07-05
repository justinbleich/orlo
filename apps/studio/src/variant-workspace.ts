import {
  applyOverrides,
  createInstance,
  resolveVariant,
  type ComponentDefinition,
  type Node,
  type NodeId,
} from "@rn-canvas/document";

export const MAX_VARIANT_PREVIEWS = 12;

export interface VariantFrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function variantPreviewCombinations(
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

export function variantPreviewKey(
  definition: ComponentDefinition,
  values: Record<string, string>,
): string {
  return (definition.variants ?? [])
    .filter((axis) => axis.values.length > 0)
    .map((axis) => `${axis.name}:${values[axis.name]}`)
    .join("|");
}

export function variantPreviewLabel(
  definition: ComponentDefinition,
  values: Record<string, string>,
): string {
  const axes = (definition.variants ?? []).filter((axis) => axis.values.length > 0);
  const base = axes.every((axis) => values[axis.name] === axis.values[0]);
  if (base) return "Base";
  return axes.map((axis) => values[axis.name]).join(" / ");
}

export function variantPreviewRoot(
  definition: ComponentDefinition,
  values: Record<string, string>,
): Node {
  const key = variantPreviewKey(definition, values).replace(/[^A-Za-z0-9_-]/g, "_");
  return applyOverrides(definition, {
    ...createInstance(definition.id, { id: `${definition.id}-preview-${key}` }),
    variant: values,
  });
}

export function variantFrameLayout(
  base: VariantFrameBox,
  combos: Record<string, string>[],
): VariantFrameBox[] {
  const gap = 48;
  const labelGutter = 32;
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, combos.length))));
  return combos.map((_, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    return {
      x: base.x + base.w + gap + col * (base.w + gap),
      y: base.y + row * (base.h + labelGutter + gap),
      w: base.w,
      h: base.h,
    };
  });
}

export function resolveStyleEditTarget({
  editingComponentId,
  definition,
  activeVariant,
  nodeId,
  nodeType,
  multi,
}: {
  editingComponentId: NodeId | null | undefined;
  definition: ComponentDefinition | undefined;
  activeVariant: Record<string, string> | undefined;
  nodeId: NodeId | undefined;
  nodeType: Node["type"] | undefined;
  multi: boolean;
}): { kind: "base" } | { kind: "variant"; values: Record<string, string> } {
  const axes = definition?.variants?.filter((axis) => axis.values.length > 0) ?? [];
  if (
    !editingComponentId ||
    !definition ||
    axes.length === 0 ||
    !nodeId ||
    multi ||
    nodeType === "ComponentInstance"
  ) {
    return { kind: "base" };
  }
  const values = resolveVariant(definition, activeVariant);
  const isDefault = axes.every((axis) => values[axis.name] === axis.values[0]);
  return isDefault ? { kind: "base" } : { kind: "variant", values };
}

export function comboHasOverrides(
  definition: ComponentDefinition,
  values: Record<string, string>,
): boolean {
  const axes = (definition.variants ?? []).filter((axis) => axis.values.length > 0);
  return !!definition.combinations?.some(
    (combo) =>
      combo.overrides.length > 0 &&
      Object.keys(combo.values).length === axes.length &&
      axes.every((axis) => combo.values[axis.name] === values[axis.name]),
  );
}
