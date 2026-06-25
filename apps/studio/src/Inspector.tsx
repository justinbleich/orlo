import { useState } from "react";
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
    shared(nodes, (n) => n.style[key]);
  const setStyle = (key: keyof Style, value: unknown) =>
    batch((id) => updateStyle(rootId!, id, { [key]: value }));
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

      {/* In focus mode, expose the selected template node's value as a component
          prop. The template root is real content here, so it's exposable too. */}
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
          <NumberField {...editLifecycle} label="P" {...num("padding")} min={0} onChange={(v) => setStyle("padding", v)} />
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
              <NumberField {...editLifecycle} label="G" {...num("gap")} min={0} onChange={(v) => setStyle("gap", v)} />
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
              <NumberField {...editLifecycle} label="S" {...num("fontSize")} min={1} onChange={(v) => setStyle("fontSize", v)} />
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
            <ColorField {...editLifecycle} value={colorVal("color")} onChange={(v) => setStyle("color", v)} />
            {!multi && <TokenBind rootId={root.id} nodeId={primary.id} styleKey="color" />}
          </Field>
        </Section>
      )}

      <Section title="Appearance">
        <Field label="Fill">
          <ColorField {...editLifecycle} value={colorVal("backgroundColor")} onChange={(v) => setStyle("backgroundColor", v)} />
          {!multi && <TokenBind rootId={root.id} nodeId={primary.id} styleKey="backgroundColor" />}
        </Field>
        <Field label="Opacity">
          <NumberField {...editLifecycle} label="○" {...num("opacity")} min={0} max={1} step={0.05} onChange={(v) => setStyle("opacity", v)} />
        </Field>
        <FieldGrid>
          <Field label="Border width">
            <NumberField {...editLifecycle} label="W" {...num("borderWidth")} min={0} onChange={(v) => setStyle("borderWidth", v)} />
          </Field>
          <Field label="Radius">
            <NumberField {...editLifecycle} label="R" {...num("borderRadius")} min={0} onChange={(v) => setStyle("borderRadius", v)} />
          </Field>
        </FieldGrid>
        <Field label="Border color">
          <ColorField {...editLifecycle} value={colorVal("borderColor")} onChange={(v) => setStyle("borderColor", v)} />
          {!multi && <TokenBind rootId={root.id} nodeId={primary.id} styleKey="borderColor" />}
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
  const [error, setError] = useState<string | null>(null);

  if (!definition) {
    return (
      <Section title="Properties">
        <p className="text-sm text-ink-faint">Component definition is missing.</p>
      </Section>
    );
  }
  if (definition.props.length === 0) {
    return (
      <Section title="Properties">
        <p className="text-sm text-ink-faint">
          No exposed properties yet. Use “Edit component” to expose some.
        </p>
      </Section>
    );
  }

  const set = (name: string, value: OverrideValue) => {
    try {
      setError(null);
      setInstanceOverride(rootId, instance.id, name, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Section title="Properties">
      <FieldGrid>
        {definition.props.map((prop) => {
          const current = instance.overrides[prop.name] ?? prop.default;
          return (
            <Field key={prop.name} label={prop.name}>
              {prop.valueType === "color" ? (
                <ColorField
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
      {error && <p className="mt-xs text-sm text-live">{error}</p>}
    </Section>
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

/** Bind/unbind a single node's color style key to a design token (Phase 2D). */
function TokenBind({ rootId, nodeId, styleKey }: { rootId: NodeId; nodeId: NodeId; styleKey: string }) {
  const tokens = useDocumentStore((s) => s.tokens);
  const root = useDocumentStore((s) => s.roots[rootId]);
  const bind = useDocumentStore((s) => s.bindStyleToken);
  const unbind = useDocumentStore((s) => s.unbindStyleToken);
  const colorTokens = Object.values(tokens).filter((t) => t.category === "color");
  if (colorTokens.length === 0) return null;
  const node = root ? findNode(root, nodeId) : undefined;
  const bound = node?.design?.tokens?.[styleKey];
  return (
    <div className="flex items-center gap-xs">
      <Select
        value={bound}
        onChange={(id) => bind(rootId, nodeId, styleKey, id)}
        options={colorTokens.map((t) => ({ value: t.id, label: t.name }))}
        placeholder="Bind token"
      />
      {bound && (
        <IconButton title="Unbind token" onClick={() => unbind(rootId, nodeId, styleKey)}>
          <X size={13} aria-hidden="true" />
        </IconButton>
      )}
    </div>
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
