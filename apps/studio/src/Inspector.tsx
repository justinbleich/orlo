import { useEffect, useState } from "react";
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Boxes,
  Copy,
  Eye,
  EyeOff,
  Group as GroupIcon,
  Image as ImageIcon,
  Lock,
  MousePointerClick,
  MoveVertical,
  List as ListIcon,
  Pencil,
  Square,
  TextCursorInput,
  Trash2,
  Type as TypeIcon,
  Ungroup as UngroupIcon,
  Unlock,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  canHaveChildren,
  childrenOf,
  findNode,
  getParent,
  isContainer,
  presetProp,
  resolveVariant,
  tokenCategoryForStyleKey,
  useDocumentStore,
  type ComponentDefinition,
  type ComponentInstanceNode,
  type Node,
  type NodeId,
  type OverrideValue,
  type PresetKind,
  type RNPrimitive,
} from "@rn-canvas/document";
import {
  absoluteConstraintMode,
  absoluteConstraintPatch,
  absoluteEdgePatch,
  absoluteMovePatch,
  sizingMode,
  sizingPatch,
  type AbsoluteConstraintMode,
  type PhysicalAxis,
  type SizingMode,
} from "@rn-canvas/styles";
import {
  deleteNodes,
  duplicateNodes,
  groupNodes,
  ungroupNode,
} from "./document-actions";
import {
  cn,
  ColorField,
  Field,
  FieldGrid,
  IconButton,
  IconToggle,
  NumberField,
  Section,
  SegmentedControl,
  Select,
  TextField,
  TokenColorField,
  TokenNumberField,
  type ColorTokenOption,
  type NumberTokenOption,
} from "./studio-ui";
import { normalizeNodeSelection, shareParent } from "./selection";
import { useStudioStore } from "./studio-store";
import {
  alignmentDeltas,
  distributionDeltas,
  type ArrangeAlignment,
} from "./canvas-arrange";

const TYPE_ICON: Record<RNPrimitive, LucideIcon> = {
  View: Square,
  Text: TypeIcon,
  Image: ImageIcon,
  Pressable: MousePointerClick,
  ScrollView: MoveVertical,
  TextInput: TextCursorInput,
  FlatList: ListIcon,
};

const JUSTIFY_OPTIONS = [
  { value: "flex-start", label: "Start" },
  { value: "center", label: "Center" },
  { value: "flex-end", label: "End" },
  { value: "space-between", label: "Space between" },
  { value: "space-around", label: "Space around" },
  { value: "space-evenly", label: "Space evenly" },
] as const;

const ALIGN_OPTIONS = [
  { value: "stretch", label: "Stretch" },
  { value: "flex-start", label: "Start" },
  { value: "center", label: "Center" },
  { value: "flex-end", label: "End" },
  { value: "baseline", label: "Baseline" },
] as const;

const WEIGHT_OPTIONS = [
  { value: "normal", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
] as const;

/** The RN style vocabulary, derived from the node model to avoid importing the
 *  styles package directly (keeps tsc resolution local to @rn-canvas/document). */
type Style = Node["style"];

/** Sentinel for "selected nodes disagree on this value". */
const MIXED = Symbol("mixed");
type Maybe<T> = T | typeof MIXED | undefined;
const isMixed = (v: unknown): v is typeof MIXED => v === MIXED;

/** Shared value of an accessor across nodes, or MIXED when they differ. */
function shared<T>(nodes: Node[], get: (n: Node) => T): Maybe<T> {
  if (nodes.length === 0) return undefined;
  const first = get(nodes[0]);
  for (let i = 1; i < nodes.length; i += 1) {
    if (!Object.is(get(nodes[i]), first)) return MIXED;
  }
  return first;
}

/** Numeric value of an Style dimension, or undefined when auto/percent/unset. */
function numeric(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** Placeholder hint for a non-numeric dimension (auto / "50%"). */
function dimHint(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function Inspector({ rootId }: { rootId: NodeId | null }) {
  const root = useDocumentStore((s) => (rootId ? s.roots[rootId] : undefined));
  const layoutResult = useStudioStore((state) =>
    rootId ? state.layouts[rootId] : undefined,
  );
  const selection = useDocumentStore((s) => s.selection);
  const updateProps = useDocumentStore((s) => s.updateProps);
  const updateStyle = useDocumentStore((s) => s.updateStyle);
  const updateDesign = useDocumentStore((s) => s.updateDesign);
  const componentRegistry = useDocumentStore((s) => s.components);
  const editingComponentId = useDocumentStore((s) => s.editingComponentId);
  const beginComponentEdit = useDocumentStore((s) => s.beginComponentEdit);
  const [error, setError] = useState<string | null>(null);

  const nodes = root
    ? normalizeNodeSelection(root, selection)
        .map((id) => findNode(root, id))
        .filter((n): n is Node => !!n)
    : [];
  const primary = nodes[0];
  const multi = nodes.length > 1;

  // Variant authoring: while a component is open in focus mode and a non-default
  // variant is selected, a single template layer's style/visibility edits route
  // into that variant's override instead of the base template.
  const setVariantOverride = useDocumentStore((s) => s.setVariantOverride);
  const activeVariant = useStudioStore((s) => s.activeVariant);
  const editingDef =
    editingComponentId && editingComponentId === rootId
      ? componentRegistry[editingComponentId]
      : undefined;
  const variantProperties = editingDef?.variants ?? [];
  const activeValues = variantProperties.length ? resolveVariant(editingDef!, activeVariant) : null;
  const isDefaultVariant =
    !activeValues || variantProperties.every((p) => activeValues[p.name] === p.values[0]);
  const variantEditing =
    !!activeValues && !isDefaultVariant && !multi && !!primary && primary.type !== "ComponentInstance";
  const variantOverrideStyle = variantEditing
    ? (editingDef!.combinations ?? [])
        .find((c) => variantProperties.every((p) => c.values[p.name] === activeValues![p.name]))
        ?.overrides.find((o) => o.nodeId === primary.id)?.style
    : undefined;

  // Clear the active variant whenever focus mode opens/closes/switches.
  const resetActiveVariant = useStudioStore((s) => s.resetActiveVariant);
  useEffect(() => resetActiveVariant(), [editingComponentId, resetActiveVariant]);

  // Batch an edit across every selected node as ONE undo entry; roll back fully
  // on validation failure. All writes go through the validated store actions.
  function batch(fn: (id: NodeId) => void) {
    const store = useDocumentStore.getState();
    const ownsInteraction = !store.interaction;
    try {
      setError(null);
      if (ownsInteraction) store.beginInteraction();
      for (const node of nodes) fn(node.id);
      if (ownsInteraction) store.commitInteraction();
    } catch (e) {
      useDocumentStore.getState().cancelInteraction();
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const editLifecycle = {
    onEditStart: () => {
      const store = useDocumentStore.getState();
      if (!store.interaction) store.beginInteraction();
    },
    onEditEnd: () => useDocumentStore.getState().commitInteraction(),
    onEditCancel: () => useDocumentStore.getState().cancelInteraction(),
  };

  const styleVal = <K extends keyof Style>(key: K): Maybe<Style[K]> =>
    shared(nodes, (n) =>
      variantEditing && n.id === primary.id
        ? ((variantOverrideStyle?.[key] ?? n.style[key]) as Style[K])
        : n.style[key],
    );
  const setStyle = (key: keyof Style, value: unknown) => {
    if (variantEditing) {
      runAction(() =>
        setVariantOverride(editingComponentId!, activeValues!, primary.id, { style: { [key]: value } }),
      );
    } else {
      batch((id) => updateStyle(rootId!, id, { [key]: value }));
    }
  };
  const setDesignAll = (partial: Record<string, unknown>) =>
    batch((id) => updateDesign(rootId!, id, partial));
  const setPrimaryProp = (key: string, value: unknown) => {
    try {
      setError(null);
      updateProps(rootId!, primary.id, { [key]: value });
    } catch (e) {
      useDocumentStore.getState().cancelInteraction();
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const runAction = (fn: () => void) => {
    try {
      setError(null);
      fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!root) {
    return (
      <Shell>
        <Empty>Select a frame to inspect.</Empty>
      </Shell>
    );
  }
  if (nodes.length === 0) {
    return (
      <Shell>
        <Empty>Select a layer to edit its properties.</Empty>
      </Shell>
    );
  }

  // A placed instance edits its exposed-prop overrides, not raw style — its
  // structure comes from the definition (edit it via focus mode).
  if (!multi && primary.type === "ComponentInstance") {
    return (
      <Shell>
        <SelectionHeader
          nodes={nodes}
          onName={(name) => setDesignAll({ name })}
          onLock={(locked) => setDesignAll({ locked })}
          onHide={(hidden) => setDesignAll({ hidden })}
          {...editLifecycle}
        />
        <div className="px-md">
          <button
            type="button"
            onClick={() => beginComponentEdit(primary.componentId)}
            className="flex w-full items-center justify-center gap-sm rounded-sm border border-line bg-chrome-2 px-sm py-control-y text-sm text-ink transition-colors hover:bg-raised"
          >
            <Pencil size={14} aria-hidden="true" /> Edit component
          </button>
        </div>
        <ActionRow
          canUngroup={false}
          canGroup={false}
          onDuplicate={() => runAction(() => duplicateNodes(root.id, [primary.id]))}
          onGroup={() => {}}
          onUngroup={() => {}}
          onDelete={() => runAction(() => deleteNodes(root.id, [primary.id]))}
        />
        <InstanceProperties
          rootId={root.id}
          instance={primary}
          definition={componentRegistry[primary.componentId]}
        />
        {error && <p className="px-md text-sm text-live">{error}</p>}
      </Shell>
    );
  }

  const allContainers = nodes.every((n) => canHaveChildren(n.type));
  const allText = nodes.every((n) => n.type === "Text");

  // Read helpers that collapse MIXED to an empty control with a mixed flag.
  const num = (key: keyof Style) => {
    const v = styleVal(key);
    return { value: isMixed(v) ? undefined : numeric(v), mixed: isMixed(v) };
  };
  const enumVal = <T,>(key: keyof Style, fallback?: T) => {
    const v = styleVal(key);
    return isMixed(v) ? undefined : ((v as T) ?? fallback);
  };
  const colorVal = (key: keyof Style) => {
    const v = styleVal(key);
    return isMixed(v) ? undefined : (v as string | undefined);
  };

  const position = enumVal<"relative" | "absolute">("position", "relative");
  const width = styleVal("width");
  const height = styleVal("height");
  const sizingParent = primary.id === root.id ? undefined : getParent(root, primary.id);
  const hasSharedFlowParent =
    !!sizingParent &&
    nodes.every(
      (node) =>
        node.style.position !== "absolute" &&
        getParent(root, node.id)?.id === sizingParent.id,
    );
  const widthSizing = hasSharedFlowParent
    ? shared(nodes, (node) => sizingMode(node.style, "horizontal", sizingParent.style))
    : undefined;
  const heightSizing = hasSharedFlowParent
    ? shared(nodes, (node) => sizingMode(node.style, "vertical", sizingParent.style))
    : undefined;

  const setSizing = (axis: PhysicalAxis, mode: SizingMode, fixedValue?: number) =>
    batch((id) => {
      const node = findNode(root, id);
      if (!node || !sizingParent) return;
      updateStyle(root.id, id, sizingPatch(node.style, axis, mode, sizingParent.style, fixedValue));
    });

  const setDimension = (axis: PhysicalAxis, value: number | undefined) => {
    if (hasSharedFlowParent) setSizing(axis, value === undefined ? "hug" : "fixed", value);
    else setStyle(axis === "horizontal" ? "width" : "height", value);
  };
  const setPositionMode = (next: "relative" | "absolute") =>
    batch((id) => {
      const node = findNode(root, id);
      const parent = node ? getParent(root, id) : undefined;
      const box = layoutResult?.snapshot.get(id)?.[0];
      const parentBox = parent ? layoutResult?.snapshot.get(parent.id)?.[0] : undefined;
      if (!node) return;
      if (next === "relative") {
        updateStyle(root.id, id, {
          position: undefined,
          left: undefined,
          right: undefined,
          top: undefined,
          bottom: undefined,
        });
        return;
      }
      const borderLeft = parent?.style.borderLeftWidth ?? parent?.style.borderWidth ?? 0;
      const borderTop = parent?.style.borderTopWidth ?? parent?.style.borderWidth ?? 0;
      updateStyle(root.id, id, {
        position: "absolute",
        left: box && parentBox ? box.left - parentBox.left - borderLeft : node.style.left ?? 0,
        top: box && parentBox ? box.top - parentBox.top - borderTop : node.style.top ?? 0,
        right: undefined,
        bottom: undefined,
        width: box?.width ?? node.style.width,
        height: box?.height ?? node.style.height,
        flex: undefined,
        flexGrow: undefined,
        flexBasis: undefined,
        alignSelf: undefined,
      });
    });
  const nodeLayout = layoutResult?.snapshot.get(primary.id)?.[0];
  const parentLayout = sizingParent
    ? layoutResult?.snapshot.get(sizingParent.id)?.[0]
    : undefined;
  const canConstrain =
    !multi && position === "absolute" && !!sizingParent && !!nodeLayout && !!parentLayout;
  const setConstraint = (axis: PhysicalAxis, mode: AbsoluteConstraintMode) => {
    if (!canConstrain || !nodeLayout || !parentLayout) return;
    const horizontal = axis === "horizontal";
    updateStyle(
      root.id,
      primary.id,
      absoluteConstraintPatch(axis, mode, {
        parentStart: horizontal ? parentLayout.left : parentLayout.top,
        parentSize: horizontal ? parentLayout.width : parentLayout.height,
        parentStartInset: horizontal
          ? sizingParent.style.borderLeftWidth ?? sizingParent.style.borderWidth
          : sizingParent.style.borderTopWidth ?? sizingParent.style.borderWidth,
        parentEndInset: horizontal
          ? sizingParent.style.borderRightWidth ?? sizingParent.style.borderWidth
          : sizingParent.style.borderBottomWidth ?? sizingParent.style.borderWidth,
        start: horizontal ? nodeLayout.left : nodeLayout.top,
        size: horizontal ? nodeLayout.width : nodeLayout.height,
      }),
    );
  };
  const setAbsoluteEdge = (
    axis: PhysicalAxis,
    edge: "start" | "end",
    value: number | undefined,
  ) =>
    batch((id) => {
      const node = findNode(root, id);
      if (!node) return;
      const box = layoutResult?.snapshot.get(id)?.[0];
      updateStyle(
        root.id,
        id,
        absoluteEdgePatch(
          node.style,
          axis,
          edge,
          value,
          box ? (axis === "horizontal" ? box.width : box.height) : undefined,
        ),
      );
    });
  const arrangeParent = primary.id === root.id ? undefined : getParent(root, primary.id);
  const sharedArrangeParent =
    arrangeParent && nodes.every((node) => getParent(root, node.id)?.id === arrangeParent.id)
      ? arrangeParent
      : undefined;
  const arrangeBoxes = nodes.flatMap((node) => {
    const box = layoutResult?.snapshot.get(node.id)?.[0];
    return box
      ? [{ id: node.id, left: box.left, top: box.top, width: box.width, height: box.height }]
      : [];
  });
  const canArrangeAbsolute =
    nodes.length >= 2 &&
    !!sharedArrangeParent &&
    arrangeBoxes.length === nodes.length &&
    nodes.every((node) => node.style.position === "absolute");
  const flowSiblings = sharedArrangeParent
    ? childrenOf(sharedArrangeParent).filter((node) => node.style.position !== "absolute")
    : [];
  const canArrangeFlex =
    nodes.length >= 2 &&
    !!sharedArrangeParent &&
    nodes.every((node) => node.style.position !== "absolute") &&
    flowSiblings.length === nodes.length &&
    flowSiblings.every((node) => nodes.some((selected) => selected.id === node.id));
  const parentMainAxis: PhysicalAxis = sharedArrangeParent?.style.flexDirection?.startsWith("row")
    ? "horizontal"
    : "vertical";

  const arrange = (axis: PhysicalAxis, alignment: ArrangeAlignment) => {
    if (canArrangeAbsolute) {
      const deltas = alignmentDeltas(arrangeBoxes, axis, alignment);
      batch((id) => {
        const node = findNode(root, id);
        if (node) updateStyle(root.id, id, absoluteMovePatch(node.style, axis, deltas.get(id) ?? 0));
      });
      return;
    }
    if (!canArrangeFlex || !sharedArrangeParent) return;
    const reverse = sharedArrangeParent.style.flexDirection?.endsWith("reverse") ?? false;
    const value =
      alignment === "center"
        ? "center"
        : alignment === "start" !== reverse
          ? "flex-start"
          : "flex-end";
    updateStyle(
      root.id,
      sharedArrangeParent.id,
      axis === parentMainAxis ? { justifyContent: value } : { alignItems: value },
    );
  };

  const distribute = (axis: PhysicalAxis) => {
    if (canArrangeAbsolute) {
      const deltas = distributionDeltas(arrangeBoxes, axis);
      batch((id) => {
        const node = findNode(root, id);
        if (node) updateStyle(root.id, id, absoluteMovePatch(node.style, axis, deltas.get(id) ?? 0));
      });
      return;
    }
    if (canArrangeFlex && sharedArrangeParent && axis === parentMainAxis) {
      updateStyle(root.id, sharedArrangeParent.id, { justifyContent: "space-between" });
    }
  };

  return (
    <Shell>
      <SelectionHeader
        nodes={nodes}
        onName={(name) => setDesignAll({ name })}
        onLock={(locked) => setDesignAll({ locked })}
        onHide={(hidden) => setDesignAll({ hidden })}
        {...editLifecycle}
      />

      {nodes.some((node) => node.id !== root.id) && (
        <ActionRow
          canUngroup={!multi && primary.id !== root.id && isContainer(primary)}
          canGroup={shareParent(root, nodes.map((node) => node.id))}
          onDuplicate={() => runAction(() => duplicateNodes(root.id, nodes.map((n) => n.id)))}
          onGroup={() => runAction(() => groupNodes(root.id, nodes.map((n) => n.id)))}
          onUngroup={() => runAction(() => ungroupNode(root.id, primary.id))}
          onDelete={() => runAction(() => deleteNodes(root.id, nodes.map((n) => n.id)))}
        />
      )}

      {/* In focus mode: manage variant properties/values, and expose the selected
          template layer's value as a component prop. */}
      {editingComponentId === root.id && (
        <VariantControls
          componentId={root.id}
          selectedNodeId={!multi && primary && primary.type !== "ComponentInstance" ? primary.id : null}
        />
      )}
      {editingComponentId === root.id && !multi && (
        <ExposeControls componentId={root.id} node={primary} />
      )}

      {(canArrangeAbsolute || canArrangeFlex) && (
        <Section title="Arrange">
          <div className="flex items-center gap-xs">
            <IconButton title="Align left" onClick={() => arrange("horizontal", "start")}>
              <AlignStartVertical size={15} aria-hidden="true" />
            </IconButton>
            <IconButton title="Align horizontal centers" onClick={() => arrange("horizontal", "center")}>
              <AlignCenterVertical size={15} aria-hidden="true" />
            </IconButton>
            <IconButton title="Align right" onClick={() => arrange("horizontal", "end")}>
              <AlignEndVertical size={15} aria-hidden="true" />
            </IconButton>
            <IconButton title="Distribute horizontally" onClick={() => distribute("horizontal")} disabled={canArrangeAbsolute ? nodes.length < 3 : parentMainAxis !== "horizontal"}>
              <AlignHorizontalSpaceBetween size={15} aria-hidden="true" />
            </IconButton>
            <div className="mx-2xs h-5 w-px bg-line" aria-hidden="true" />
            <IconButton title="Align top" onClick={() => arrange("vertical", "start")}>
              <AlignStartHorizontal size={15} aria-hidden="true" />
            </IconButton>
            <IconButton title="Align vertical centers" onClick={() => arrange("vertical", "center")}>
              <AlignCenterHorizontal size={15} aria-hidden="true" />
            </IconButton>
            <IconButton title="Align bottom" onClick={() => arrange("vertical", "end")}>
              <AlignEndHorizontal size={15} aria-hidden="true" />
            </IconButton>
            <IconButton title="Distribute vertically" onClick={() => distribute("vertical")} disabled={canArrangeAbsolute ? nodes.length < 3 : parentMainAxis !== "vertical"}>
              <AlignVerticalSpaceBetween size={15} aria-hidden="true" />
            </IconButton>
          </div>
        </Section>
      )}

      <Section title="Layout">
        <Field label="Position">
          <SegmentedControl
            value={position}
            onChange={setPositionMode}
            options={[
              { value: "relative", content: "Relative", title: "Relative (flow)" },
              { value: "absolute", content: "Absolute", title: "Absolute (top/left)" },
            ]}
          />
        </Field>
        {hasSharedFlowParent && (
          <FieldGrid>
            <Field label="Width sizing">
              <SegmentedControl
                value={isMixed(widthSizing) ? undefined : widthSizing}
                onChange={(value) => setSizing("horizontal", value)}
                options={[
                  { value: "hug", content: "Hug", title: "Width: Hug" },
                  { value: "fill", content: "Fill", title: "Width: Fill" },
                  { value: "fixed", content: "Fixed", title: "Width: Fixed" },
                ]}
              />
            </Field>
            <Field label="Height sizing">
              <SegmentedControl
                value={isMixed(heightSizing) ? undefined : heightSizing}
                onChange={(value) => setSizing("vertical", value)}
                options={[
                  { value: "hug", content: "Hug", title: "Height: Hug" },
                  { value: "fill", content: "Fill", title: "Height: Fill" },
                  { value: "fixed", content: "Fixed", title: "Height: Fixed" },
                ]}
              />
            </Field>
          </FieldGrid>
        )}
        <FieldGrid>
          <Field label="Width">
            <NumberField
              {...editLifecycle}
              label="W"
              value={isMixed(width) ? undefined : numeric(width)}
              mixed={isMixed(width)}
              placeholder={isMixed(width) ? undefined : dimHint(width) ?? "auto"}
              min={0}
              onChange={(v) => setDimension("horizontal", v)}
            />
          </Field>
          <Field label="Height">
            <NumberField
              {...editLifecycle}
              label="H"
              value={isMixed(height) ? undefined : numeric(height)}
              mixed={isMixed(height)}
              placeholder={isMixed(height) ? undefined : dimHint(height) ?? "auto"}
              min={0}
              onChange={(v) => setDimension("vertical", v)}
            />
          </Field>
        </FieldGrid>
        {position === "absolute" && (
          <>
            {canConstrain && (
              <>
                <Field label="Horizontal constraint">
                  <SegmentedControl
                    value={absoluteConstraintMode(primary.style, "horizontal")}
                    onChange={(value) => setConstraint("horizontal", value)}
                    options={[
                      { value: "start", content: "Left", title: "Pin left" },
                      { value: "end", content: "Right", title: "Pin right" },
                      { value: "stretch", content: "Stretch", title: "Pin left and right" },
                    ]}
                  />
                </Field>
                <Field label="Vertical constraint">
                  <SegmentedControl
                    value={absoluteConstraintMode(primary.style, "vertical")}
                    onChange={(value) => setConstraint("vertical", value)}
                    options={[
                      { value: "start", content: "Top", title: "Pin top" },
                      { value: "end", content: "Bottom", title: "Pin bottom" },
                      { value: "stretch", content: "Stretch", title: "Pin top and bottom" },
                    ]}
                  />
                </Field>
              </>
            )}
            <FieldGrid>
              <Field label="Left">
                <NumberField {...editLifecycle} label="L" {...num("left")} onChange={(v) => setAbsoluteEdge("horizontal", "start", v)} />
              </Field>
              <Field label="Right">
                <NumberField {...editLifecycle} label="R" {...num("right")} onChange={(v) => setAbsoluteEdge("horizontal", "end", v)} />
              </Field>
            </FieldGrid>
            <FieldGrid>
              <Field label="Top">
                <NumberField {...editLifecycle} label="T" {...num("top")} onChange={(v) => setAbsoluteEdge("vertical", "start", v)} />
              </Field>
              <Field label="Bottom">
                <NumberField {...editLifecycle} label="B" {...num("bottom")} onChange={(v) => setAbsoluteEdge("vertical", "end", v)} />
              </Field>
            </FieldGrid>
          </>
        )}
        <Field label="Padding">
          {!multi ? (
            <NumberTokenSlot rootId={root.id} nodeId={primary.id} styleKey="padding" label="P" {...num("padding")} min={0} onChange={(v) => setStyle("padding", v)} editLifecycle={editLifecycle} />
          ) : (
            <NumberField {...editLifecycle} label="P" {...num("padding")} min={0} onChange={(v) => setStyle("padding", v)} />
          )}
        </Field>
      </Section>

      {allContainers && (
        <Section title="Auto Layout">
          <Field label="Direction">
            <SegmentedControl
              value={enumVal<Style["flexDirection"]>("flexDirection", "column")}
              onChange={(v) => setStyle("flexDirection", v)}
              options={[
                { value: "row", content: <ArrowRight size={14} aria-hidden="true" />, title: "Row" },
                { value: "column", content: <ArrowDown size={14} aria-hidden="true" />, title: "Column" },
                { value: "row-reverse", content: <ArrowLeft size={14} aria-hidden="true" />, title: "Row reverse" },
                { value: "column-reverse", content: <ArrowUp size={14} aria-hidden="true" />, title: "Column reverse" },
              ]}
            />
          </Field>
          <Field label="Justify">
            <Select value={enumVal<string>("justifyContent")} onChange={(v) => setStyle("justifyContent", v)} options={JUSTIFY_OPTIONS as never} placeholder="Start" />
          </Field>
          <Field label="Align">
            <Select value={enumVal<string>("alignItems")} onChange={(v) => setStyle("alignItems", v)} options={ALIGN_OPTIONS as never} placeholder="Stretch" />
          </Field>
          <FieldGrid>
            <Field label="Gap">
              {!multi ? (
                <NumberTokenSlot rootId={root.id} nodeId={primary.id} styleKey="gap" label="G" {...num("gap")} min={0} onChange={(v) => setStyle("gap", v)} editLifecycle={editLifecycle} />
              ) : (
                <NumberField {...editLifecycle} label="G" {...num("gap")} min={0} onChange={(v) => setStyle("gap", v)} />
              )}
            </Field>
            <Field label="Wrap">
              <SegmentedControl
                value={enumVal<Style["flexWrap"]>("flexWrap", "nowrap")}
                onChange={(v) => setStyle("flexWrap", v === "nowrap" ? undefined : v)}
                options={[
                  { value: "nowrap", content: "No", title: "No wrap" },
                  { value: "wrap", content: "Wrap", title: "Wrap" },
                ]}
              />
            </Field>
          </FieldGrid>
        </Section>
      )}

      {allText && (
        <Section title="Typography">
          {!multi && primary.type === "Text" && (
            <Field label="Content" stacked>
              <TextField {...editLifecycle} value={primary.props.text} onChange={(v) => setPrimaryProp("text", v)} placeholder="Text…" />
            </Field>
          )}
          <FieldGrid>
            <Field label="Size">
              {!multi ? (
                <NumberTokenSlot rootId={root.id} nodeId={primary.id} styleKey="fontSize" label="S" {...num("fontSize")} min={1} onChange={(v) => setStyle("fontSize", v)} editLifecycle={editLifecycle} />
              ) : (
                <NumberField {...editLifecycle} label="S" {...num("fontSize")} min={1} onChange={(v) => setStyle("fontSize", v)} />
              )}
            </Field>
            <Field label="Line height">
              <NumberField {...editLifecycle} label="LH" {...num("lineHeight")} min={0} onChange={(v) => setStyle("lineHeight", v)} />
            </Field>
          </FieldGrid>
          <Field label="Weight">
            <Select value={enumVal<string>("fontWeight")} onChange={(v) => setStyle("fontWeight", v)} options={WEIGHT_OPTIONS as never} placeholder="Regular" />
          </Field>
          <Field label="Align">
            <SegmentedControl
              value={(() => {
                const a = enumVal<Style["textAlign"]>("textAlign", "left");
                return a && a !== "auto" ? a : a === undefined ? undefined : "left";
              })()}
              onChange={(v) => setStyle("textAlign", v)}
              options={[
                { value: "left", content: <AlignLeft size={14} aria-hidden="true" />, title: "Left" },
                { value: "center", content: <AlignCenter size={14} aria-hidden="true" />, title: "Center" },
                { value: "right", content: <AlignRight size={14} aria-hidden="true" />, title: "Right" },
                { value: "justify", content: <AlignJustify size={14} aria-hidden="true" />, title: "Justify" },
              ]}
            />
          </Field>
          <Field label="Color">
            {!multi ? (
              <ColorTokenSlot rootId={root.id} nodeId={primary.id} styleKey="color" value={colorVal("color")} onChange={(v) => setStyle("color", v)} editLifecycle={editLifecycle} />
            ) : (
              <ColorField {...editLifecycle} value={colorVal("color")} onChange={(v) => setStyle("color", v)} />
            )}
          </Field>
        </Section>
      )}

      <Section title="Appearance">
        <Field label="Fill">
          {!multi ? (
            <ColorTokenSlot rootId={root.id} nodeId={primary.id} styleKey="backgroundColor" value={colorVal("backgroundColor")} onChange={(v) => setStyle("backgroundColor", v)} editLifecycle={editLifecycle} />
          ) : (
            <ColorField {...editLifecycle} value={colorVal("backgroundColor")} onChange={(v) => setStyle("backgroundColor", v)} />
          )}
        </Field>
        <Field label="Opacity">
          <NumberField {...editLifecycle} label="○" {...num("opacity")} min={0} max={1} step={0.05} onChange={(v) => setStyle("opacity", v)} />
        </Field>
        <FieldGrid>
          <Field label="Border width">
            <NumberField {...editLifecycle} label="W" {...num("borderWidth")} min={0} onChange={(v) => setStyle("borderWidth", v)} />
          </Field>
          <Field label="Radius">
            {!multi ? (
              <NumberTokenSlot rootId={root.id} nodeId={primary.id} styleKey="borderRadius" label="R" {...num("borderRadius")} min={0} onChange={(v) => setStyle("borderRadius", v)} editLifecycle={editLifecycle} />
            ) : (
              <NumberField {...editLifecycle} label="R" {...num("borderRadius")} min={0} onChange={(v) => setStyle("borderRadius", v)} />
            )}
          </Field>
        </FieldGrid>
        <Field label="Border color">
          {!multi ? (
            <ColorTokenSlot rootId={root.id} nodeId={primary.id} styleKey="borderColor" value={colorVal("borderColor")} onChange={(v) => setStyle("borderColor", v)} editLifecycle={editLifecycle} />
          ) : (
            <ColorField {...editLifecycle} value={colorVal("borderColor")} onChange={(v) => setStyle("borderColor", v)} />
          )}
        </Field>
      </Section>

      {error && (
        <div className="mx-md mb-md rounded-sm border border-amber/40 bg-amber/10 px-sm py-xs text-xs text-amber">
          {error}
        </div>
      )}
    </Shell>
  );
}

function ActionRow({
  canGroup,
  canUngroup,
  onDuplicate,
  onGroup,
  onUngroup,
  onDelete,
}: {
  canGroup: boolean;
  canUngroup: boolean;
  onDuplicate: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-xs border-b border-line-soft px-md py-sm">
      <IconButton title="Duplicate (⌘D)" onClick={onDuplicate}>
        <Copy size={14} aria-hidden="true" />
      </IconButton>
      {canGroup && (
        <IconButton title="Group into a View" onClick={onGroup}>
          <GroupIcon size={14} aria-hidden="true" />
        </IconButton>
      )}
      {canUngroup && (
        <IconButton title="Ungroup" onClick={onUngroup}>
          <UngroupIcon size={14} aria-hidden="true" />
        </IconButton>
      )}
      <div className="flex-1" />
      <IconButton title="Delete (⌫)" onClick={onDelete}>
        <Trash2 size={14} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto bg-chrome">
      {children}
    </aside>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-md text-center text-sm text-ink-faint">
      {children}
    </div>
  );
}

function SelectionHeader({
  nodes,
  onName,
  onLock,
  onHide,
  onEditStart,
  onEditEnd,
  onEditCancel,
}: {
  nodes: Node[];
  onName: (name: string) => void;
  onLock: (locked: boolean) => void;
  onHide: (hidden: boolean) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
  onEditCancel: () => void;
}) {
  const multi = nodes.length > 1;
  const primary = nodes[0];
  const Icon = multi ? Boxes : (TYPE_ICON[primary.type as keyof typeof TYPE_ICON] ?? Boxes);
  const anyLocked = nodes.some((n) => n.design?.locked);
  const anyHidden = nodes.some((n) => n.design?.hidden);
  return (
    <div className="flex flex-col gap-sm border-b border-line px-md py-md">
      <div className="flex items-center gap-sm">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-chrome-2 text-ink-dim">
          <Icon size={15} aria-hidden="true" />
        </span>
        {multi ? (
          <span className="flex h-7 min-w-0 flex-1 items-center px-sm text-sm font-medium text-ink">
            {nodes.length} layers selected
          </span>
        ) : (
          <input
            value={primary.design?.name ?? ""}
            placeholder={primary.type}
            onFocus={onEditStart}
            onBlur={onEditEnd}
            onChange={(e) => {
              onEditStart();
              onName(e.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") onEditCancel();
            }}
            className="h-7 min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-sm text-sm font-medium text-ink transition-colors hover:border-line focus-visible:border-accent-line focus-visible:bg-chrome-2 focus-visible:outline-none"
          />
        )}
        <IconToggle title={anyLocked ? "Unlock" : "Lock"} pressed={anyLocked} onPressedChange={onLock}>
          {anyLocked ? <Lock size={14} aria-hidden="true" /> : <Unlock size={14} aria-hidden="true" />}
        </IconToggle>
        <IconToggle title={anyHidden ? "Show" : "Hide"} pressed={anyHidden} onPressedChange={onHide}>
          {anyHidden ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
        </IconToggle>
      </div>
      <div className="eyebrow pl-2xs">
        {multi ? `${nodes.length} layers` : `${primary.type} · ${primary.id.slice(0, 8)}`}
      </div>
    </div>
  );
}

/** A JS identifier derived from `base`, unique against `taken`. */
function uniquePropName(base: string, taken: Iterable<string>): string {
  const ident = /^[A-Za-z_$]/.test(base) ? base.replace(/[^\w$]/g, "") : `p${base.replace(/[^\w$]/g, "")}`;
  const root = ident || "prop";
  const used = new Set(taken);
  if (!used.has(root)) return root;
  let i = 2;
  while (used.has(`${root}${i}`)) i += 1;
  return `${root}${i}`;
}

/** Per-instance override editors for a definition's exposed props. */
function InstanceProperties({
  rootId,
  instance,
  definition,
}: {
  rootId: NodeId;
  instance: ComponentInstanceNode;
  definition: ComponentDefinition | undefined;
}) {
  const setInstanceOverride = useDocumentStore((s) => s.setInstanceOverride);
  const setInstanceVariant = useDocumentStore((s) => s.setInstanceVariant);
  const [error, setError] = useState<string | null>(null);

  if (!definition) {
    return (
      <Section title="Properties">
        <p className="text-sm text-ink-faint">Component definition is missing.</p>
      </Section>
    );
  }

  const properties = definition.variants ?? [];
  const set = (name: string, value: OverrideValue) => {
    try {
      setError(null);
      setInstanceOverride(rootId, instance.id, name, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const setVariant = (propertyName: string, value: string) => {
    try {
      setError(null);
      setInstanceVariant(rootId, instance.id, propertyName, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      {properties.length > 0 && (
        <Section title="Variant">
          <FieldGrid>
            {properties.map((property) => (
              <Field key={property.name} label={property.name}>
                <Select
                  value={instance.variant?.[property.name] ?? property.values[0]}
                  onChange={(v) => setVariant(property.name, v)}
                  options={property.values.map((value) => ({ value, label: value }))}
                />
              </Field>
            ))}
          </FieldGrid>
        </Section>
      )}
      {definition.props.length === 0 ? (
        <Section title="Properties">
          <p className="text-sm text-ink-faint">
            No exposed properties yet. Use “Edit component” to expose some.
          </p>
        </Section>
      ) : (
        <Section title="Properties">
          <FieldGrid>
        {definition.props.map((prop) => {
          const current = instance.overrides[prop.name] ?? prop.default;
          return (
            <Field key={prop.name} label={prop.name}>
              {prop.valueType === "color" ? (
                <InstanceColorOverrideSlot
                  rootId={rootId}
                  instanceId={instance.id}
                  propName={prop.name}
                  value={typeof current === "string" ? current : undefined}
                  onChange={(v) => set(prop.name, v)}
                />
              ) : prop.valueType === "boolean" ? (
                <SegmentedControl
                  value={current === false ? "off" : "on"}
                  onChange={(v) => set(prop.name, v === "on")}
                  options={[
                    { value: "on", content: "On", title: "On" },
                    { value: "off", content: "Off", title: "Off" },
                  ]}
                />
              ) : prop.valueType === "number" ? (
                <NumberField
                  label=""
                  value={typeof current === "number" ? current : undefined}
                  onChange={(v) => v !== undefined && set(prop.name, v)}
                />
              ) : prop.valueType === "enum" ? (
                <Select
                  value={typeof current === "string" ? current : undefined}
                  onChange={(v) => set(prop.name, v)}
                  options={(prop.enumValues ?? []).map((value) => ({ value, label: value }))}
                />
              ) : prop.valueType === "node" ? (
                <span className="text-sm text-ink-faint">Slot — edit on canvas</span>
              ) : (
                <TextField
                  value={typeof current === "string" ? current : ""}
                  onChange={(v) => set(prop.name, v)}
                />
              )}
            </Field>
          );
        })}
          </FieldGrid>
        </Section>
      )}
      {error && <p className="px-md text-sm text-live">{error}</p>}
    </>
  );
}

/** Focus-mode variant editor: manage variant properties + values, pick the
 *  variant being authored via a matrix preview (non-default selections route
 *  layer style/visibility edits into it), and toggle a layer's visibility
 *  within the active variant. */
function VariantControls({
  componentId,
  selectedNodeId,
}: {
  componentId: NodeId;
  selectedNodeId: NodeId | null;
}) {
  const def = useDocumentStore((s) => s.components[componentId]);
  const addVariantAxis = useDocumentStore((s) => s.addVariantAxis);
  const removeVariantAxis = useDocumentStore((s) => s.removeVariantAxis);
  const addVariantValue = useDocumentStore((s) => s.addVariantValue);
  const removeVariantValue = useDocumentStore((s) => s.removeVariantValue);
  const setVariantOverride = useDocumentStore((s) => s.setVariantOverride);
  const activeVariant = useStudioStore((s) => s.activeVariant);
  const setActiveVariant = useStudioStore((s) => s.setActiveVariant);
  const [propertyDraft, setPropertyDraft] = useState("");
  const [valueDrafts, setValueDrafts] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  if (!def) return null;
  const properties = def.variants ?? [];
  const run = (fn: () => void) => {
    try {
      setErr(null);
      fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const activeValues: Record<string, string> =
    properties.length ? resolveVariant(def, activeVariant) : {};
  const isDefault = properties.every((p) => activeValues[p.name] === p.values[0]);
  const hiddenHere =
    !isDefault && selectedNodeId
      ? !!(def.combinations ?? [])
          .find((c) => properties.every((p) => c.values[p.name] === activeValues[p.name]))
          ?.overrides.find((o) => o.nodeId === selectedNodeId)?.hidden
      : false;

  const inputCls =
    "h-7 min-w-0 flex-1 rounded-sm border border-line bg-chrome-2 px-sm text-xs text-ink placeholder:text-ink-faint outline-none focus-visible:border-accent-line focus-visible:bg-raised";

  return (
    <Section title="Variants">
      <div className="flex flex-col gap-control">
        {properties.map((property) => (
          <div key={property.name} className="flex flex-col gap-2xs rounded-sm border border-line/40 p-xs">
            <div className="flex items-center gap-xs">
              <span className="flex-1 font-mono text-xs text-ink">{property.name}</span>
              <button
                type="button"
                title={`Remove property ${property.name}`}
                onClick={() => run(() => removeVariantAxis(componentId, property.name))}
                className="text-ink-faint hover:text-ink"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2xs">
              {property.values.map((value) => (
                <span
                  key={value}
                  className="inline-flex items-center gap-2xs rounded-xs border border-line bg-chrome-2 px-xs py-2xs text-2xs text-ink-dim"
                >
                  {value}
                  {property.values.length > 1 && (
                    <button
                      type="button"
                      title={`Remove ${value}`}
                      onClick={() => run(() => removeVariantValue(componentId, property.name, value))}
                      className="text-ink-faint hover:text-ink"
                    >
                      <X size={10} aria-hidden="true" />
                    </button>
                  )}
                </span>
              ))}
              <input
                value={valueDrafts[property.name] ?? ""}
                onChange={(e) => setValueDrafts((d) => ({ ...d, [property.name]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = (valueDrafts[property.name] ?? "").trim();
                    if (v) {
                      run(() => addVariantValue(componentId, property.name, v));
                      setValueDrafts((d) => ({ ...d, [property.name]: "" }));
                    }
                  }
                }}
                placeholder="+ value"
                spellCheck={false}
                className={cn(inputCls, "h-6 w-20 flex-none")}
              />
            </div>
          </div>
        ))}

        <div className="flex items-center gap-xs">
          <input
            value={propertyDraft}
            onChange={(e) => setPropertyDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && propertyDraft.trim()) {
                run(() => addVariantAxis(componentId, propertyDraft.trim()));
                setPropertyDraft("");
              }
            }}
            placeholder="New property (e.g. size)"
            spellCheck={false}
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => {
              if (propertyDraft.trim()) {
                run(() => addVariantAxis(componentId, propertyDraft.trim()));
                setPropertyDraft("");
              }
            }}
            className="rounded-sm border border-line bg-chrome-2 px-sm py-control-y text-xs text-ink hover:bg-raised"
          >
            Add property
          </button>
        </div>

        {properties.length > 0 && (
          <>
            <div className="eyebrow pt-xs">Editing variant</div>
            <VariantPicker
              properties={properties}
              activeValues={activeValues}
              onSelect={(values) => {
                for (const p of properties) setActiveVariant(p.name, values[p.name]);
              }}
            />
            <p className={cn("m-0 text-xs", isDefault ? "text-ink-faint" : "text-accent")}>
              {isDefault
                ? "Editing the default variant — pick another cell to author an override."
                : `Edits apply to ${properties
                    .map((p) => `${p.name}=${activeValues[p.name]}`)
                    .join(", ")}.`}
            </p>
            {!isDefault && selectedNodeId && (
              <label className="flex items-center gap-xs text-xs text-ink">
                <input
                  type="checkbox"
                  checked={hiddenHere}
                  onChange={(e) =>
                    run(() =>
                      setVariantOverride(componentId, activeValues, selectedNodeId, {
                        hidden: e.target.checked ? true : null,
                      }),
                    )
                  }
                />
                Hide this layer in this variant
              </label>
            )}
          </>
        )}
        {err && <p className="m-0 text-xs text-live">{err}</p>}
      </div>
    </Section>
  );
}

/** Compact picker for the active variant. 1 property → chip row. 2 properties →
 *  matrix grid. 3+ → per-property dropdowns (matrix would be unwieldy). */
function VariantPicker({
  properties,
  activeValues,
  onSelect,
}: {
  properties: { name: string; values: string[] }[];
  activeValues: Record<string, string>;
  onSelect: (values: Record<string, string>) => void;
}) {
  if (properties.length === 1) {
    const property = properties[0];
    return (
      <div className="flex flex-wrap gap-2xs">
        {property.values.map((value) => {
          const active = activeValues[property.name] === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onSelect({ ...activeValues, [property.name]: value })}
              className={cn(
                "rounded-xs border px-xs py-2xs text-2xs transition-colors",
                active
                  ? "border-accent-line bg-accent-soft text-accent"
                  : "border-line bg-chrome-2 text-ink-dim hover:bg-raised hover:text-ink",
              )}
            >
              {value}
            </button>
          );
        })}
      </div>
    );
  }
  if (properties.length === 2) {
    const [rowProp, colProp] = properties;
    return (
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-2xs text-2xs">
          <thead>
            <tr>
              <td />
              {colProp.values.map((cv) => (
                <th
                  key={cv}
                  className="px-xs py-2xs text-left font-normal text-ink-faint"
                  title={`${colProp.name} = ${cv}`}
                >
                  {cv}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowProp.values.map((rv) => (
              <tr key={rv}>
                <th
                  className="pr-xs text-right font-normal text-ink-faint"
                  title={`${rowProp.name} = ${rv}`}
                >
                  {rv}
                </th>
                {colProp.values.map((cv) => {
                  const active =
                    activeValues[rowProp.name] === rv && activeValues[colProp.name] === cv;
                  return (
                    <td key={cv}>
                      <button
                        type="button"
                        title={`${rowProp.name}=${rv}, ${colProp.name}=${cv}`}
                        onClick={() =>
                          onSelect({
                            ...activeValues,
                            [rowProp.name]: rv,
                            [colProp.name]: cv,
                          })
                        }
                        className={cn(
                          "h-6 w-6 rounded-xs border transition-colors",
                          active
                            ? "border-accent-line bg-accent-soft"
                            : "border-line bg-chrome-2 hover:bg-raised",
                        )}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <FieldGrid>
      {properties.map((property) => (
        <Field key={property.name} label={property.name}>
          <Select
            value={activeValues[property.name]}
            onChange={(v) => onSelect({ ...activeValues, [property.name]: v })}
            options={property.values.map((value) => ({ value, label: value }))}
          />
        </Field>
      ))}
    </FieldGrid>
  );
}

/** Expose a selected template node's value as a component prop (focus mode). */
function ExposeControls({ componentId, node }: { componentId: NodeId; node: Node }) {
  const components = useDocumentStore((s) => s.components);
  const updateComponent = useDocumentStore((s) => s.updateComponent);
  const definition = components[componentId];
  if (!definition) return null;
  const props = definition.props;

  const expose = (kind: PresetKind, styleKey?: "color" | "backgroundColor") => {
    const base =
      kind === "text" ? "text"
      : kind === "color" ? (styleKey === "color" ? "textColor" : "background")
      : kind === "visibility" ? "visible"
      : "slot";
    const name = uniquePropName(base, props.map((p) => p.name));
    updateComponent(componentId, {
      props: [...props, presetProp(name, kind, node.id, styleKey)],
    });
  };
  const remove = (name: string) =>
    updateComponent(componentId, { props: props.filter((p) => p.name !== name) });

  const colorKey = node.type === "Text" ? "color" : "backgroundColor";

  return (
    <Section title="Expose as property">
      <div className="flex flex-wrap gap-xs">
        {node.type === "Text" && (
          <ExposeButton label="Text" onClick={() => expose("text")} />
        )}
        <ExposeButton label="Color" onClick={() => expose("color", colorKey)} />
        <ExposeButton label="Visibility" onClick={() => expose("visibility")} />
        {isContainer(node) && <ExposeButton label="Slot" onClick={() => expose("slot")} />}
      </div>
      {props.length > 0 && (
        <div className="mt-sm flex flex-col gap-2xs">
          {props.map((prop) => (
            <div key={prop.name} className="flex items-center justify-between gap-sm text-sm">
              <span>
                {prop.name} <span className="text-ink-faint">· {prop.valueType}</span>
              </span>
              <IconButton title={`Remove ${prop.name}`} onClick={() => remove(prop.name)}>
                <Trash2 size={13} aria-hidden="true" />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

const PROMOTE_PREFIX: Record<"color" | "spacing" | "fontSize", string> = {
  color: "color",
  spacing: "space",
  fontSize: "text",
};

/** Suggest a sensible default name for promote-from-value: `<prefix><n>` where
 *  n is the next free index among existing tokens of this category. */
function nextDefaultPromoteName(
  tokens: Record<string, { name: string; category: "color" | "spacing" | "fontSize" }>,
  category: "color" | "spacing" | "fontSize",
): string {
  const prefix = PROMOTE_PREFIX[category];
  const taken = new Set(
    Object.values(tokens)
      .filter((t) => t.category === category)
      .map((t) => t.name),
  );
  let i = 1;
  while (taken.has(`${prefix}${i}`)) i += 1;
  return `${prefix}${i}`;
}

/** Color-field with token popover. Wires TokenColorField against the document store. */
function ColorTokenSlot({
  rootId,
  nodeId,
  styleKey,
  value,
  onChange,
  editLifecycle,
}: {
  rootId: NodeId;
  nodeId: NodeId;
  styleKey: string;
  value: string | undefined;
  onChange: (v: string) => void;
  editLifecycle: { onEditStart?: () => void; onEditEnd?: () => void; onEditCancel?: () => void };
}) {
  const tokens = useDocumentStore((s) => s.tokens);
  const root = useDocumentStore((s) => s.roots[rootId]);
  const link = useDocumentStore((s) => s.linkStyleToken);
  const unlink = useDocumentStore((s) => s.unlinkStyleToken);
  const promote = useDocumentStore((s) => s.promoteStyleToToken);
  const node = root ? findNode(root, nodeId) : undefined;
  const linkedTokenId = node?.design?.tokens?.[styleKey];
  const colorOptions: ColorTokenOption[] = Object.values(tokens)
    .filter((t) => t.category === "color")
    .map((t) => ({ id: t.id, name: t.name, value: t.value as string }));
  return (
    <TokenColorField
      {...editLifecycle}
      value={value}
      onChange={onChange}
      tokens={colorOptions}
      linkedTokenId={linkedTokenId}
      defaultPromoteName={nextDefaultPromoteName(tokens, "color")}
      onLink={(id) => link(rootId, nodeId, styleKey, id)}
      onUnlink={() => unlink(rootId, nodeId, styleKey)}
      onPromote={(name) => promote(rootId, nodeId, styleKey, name)}
    />
  );
}

/** Color override on a component instance, with token popover. Mirrors
 *  ColorTokenSlot but writes to `instance.overrides` + `instance.tokens`. */
function InstanceColorOverrideSlot({
  rootId,
  instanceId,
  propName,
  value,
  onChange,
}: {
  rootId: NodeId;
  instanceId: NodeId;
  propName: string;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const tokens = useDocumentStore((s) => s.tokens);
  const root = useDocumentStore((s) => s.roots[rootId]);
  const link = useDocumentStore((s) => s.linkInstanceToken);
  const unlink = useDocumentStore((s) => s.unlinkInstanceToken);
  const promote = useDocumentStore((s) => s.promoteInstanceOverrideToToken);
  const node = root ? findNode(root, instanceId) : undefined;
  const linkedTokenId =
    node?.type === "ComponentInstance" ? node.tokens?.[propName] : undefined;
  const colorOptions: ColorTokenOption[] = Object.values(tokens)
    .filter((t) => t.category === "color")
    .map((t) => ({ id: t.id, name: t.name, value: t.value as string }));
  return (
    <TokenColorField
      value={value}
      onChange={onChange}
      tokens={colorOptions}
      linkedTokenId={linkedTokenId}
      defaultPromoteName={nextDefaultPromoteName(tokens, "color")}
      onLink={(id) => link(rootId, instanceId, propName, id)}
      onUnlink={() => unlink(rootId, instanceId, propName)}
      onPromote={(name) => promote(rootId, instanceId, propName, "color", name)}
    />
  );
}

/** NumberField with token popover for spacing/fontSize style keys. */
function NumberTokenSlot({
  rootId,
  nodeId,
  styleKey,
  label,
  value,
  onChange,
  min,
  max,
  step,
  mixed,
  placeholder,
  editLifecycle,
}: {
  rootId: NodeId;
  nodeId: NodeId;
  styleKey: string;
  label: React.ReactNode;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  mixed?: boolean;
  placeholder?: string;
  editLifecycle: { onEditStart?: () => void; onEditEnd?: () => void; onEditCancel?: () => void };
}) {
  const tokens = useDocumentStore((s) => s.tokens);
  const root = useDocumentStore((s) => s.roots[rootId]);
  const link = useDocumentStore((s) => s.linkStyleToken);
  const unlink = useDocumentStore((s) => s.unlinkStyleToken);
  const promote = useDocumentStore((s) => s.promoteStyleToToken);
  const category = tokenCategoryForStyleKey(styleKey);
  // Caller passes only spacing/fontSize keys; if a wrong key slips in fall back
  // to a plain NumberField so we never silently swallow the input.
  if (category !== "spacing" && category !== "fontSize") {
    return (
      <NumberField
        {...editLifecycle}
        label={label}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        mixed={mixed}
        placeholder={placeholder}
      />
    );
  }
  const node = root ? findNode(root, nodeId) : undefined;
  const linkedTokenId = node?.design?.tokens?.[styleKey];
  const numberOptions: NumberTokenOption[] = Object.values(tokens)
    .filter((t) => t.category === category)
    .map((t) => ({ id: t.id, name: t.name, value: t.value as number }));
  return (
    <TokenNumberField
      {...editLifecycle}
      label={label}
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      step={step}
      mixed={mixed}
      placeholder={placeholder}
      category={category}
      tokens={numberOptions}
      linkedTokenId={linkedTokenId}
      defaultPromoteName={nextDefaultPromoteName(tokens, category)}
      onLink={(id) => link(rootId, nodeId, styleKey, id)}
      onUnlink={() => unlink(rootId, nodeId, styleKey)}
      onPromote={(name) => promote(rootId, nodeId, styleKey, name)}
    />
  );
}

function ExposeButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm border border-line bg-chrome-2 px-sm py-control-y text-sm text-ink-dim transition-colors hover:bg-raised hover:text-ink"
    >
      + {label}
    </button>
  );
}
