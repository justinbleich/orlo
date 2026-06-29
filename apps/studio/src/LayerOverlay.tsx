import { useMemo, useRef, useState } from "react";
import {
  childrenOf,
  createInstance,
  findNode,
  getParent,
  ownerInstanceId,
  useDocumentStore,
  type Node,
  type NodeId,
  type RNPrimitive,
} from "@rn-canvas/document";
import type { LayoutBox, LayoutReadyResult } from "@rn-canvas/render-web";
import {
  buildDrawnNode,
  containerAt,
  drawSize,
  flexBlockInParent,
  flexFlowHorizontal,
  flexInsertIndex,
  hitTestLayout,
  rectOf,
  type Point,
  type Rect,
} from "./canvas-interaction";
import { reorderFlexBlock } from "./document-actions";
import { canvasGuide, color, font, radius, text } from "./studio-theme";
import { useStudioStore } from "./studio-store";
import { normalizeNodeSelection } from "./selection";
import { absoluteConstraintMode, absoluteMovePatch } from "@rn-canvas/styles";
import { smartSnap, type SnapRect } from "./canvas-snap";
import { equalSpacingSnap, type SpacingRect, type SpacingSegment } from "./canvas-spacing";

type ResizeHandle = "nw" | "ne" | "se" | "sw";
type GroupMember = { nodeId: NodeId; left: number; top: number; width: number; height: number; style: Node["style"] };
type Gesture = {
  kind: "move" | "resize" | "marquee" | "create";
  pointerId: number;
  nodeId: NodeId;
  instanceKey: string;
  start: Point;
  box: LayoutBox;
  parentBox?: LayoutBox;
  handle?: ResizeHandle;
  /** Absolute-positioned selected nodes moved together during a group drag. */
  group: GroupMember[];
  /** Flex siblings reordered together on drop (flex-flow creation model). */
  flexBlock: NodeId[];
  additive: boolean;
  moved: boolean;
  /** For a create gesture: the armed primitive being drawn. */
  createType?: RNPrimitive;
  /** For a create gesture: the armed component being placed as an instance. */
  createComponentId?: string;
  /** Parent flow shown while this child is being reordered. */
  layoutGuide?: { box: LayoutBox; horizontal: boolean };
  snapBounds?: SnapRect;
  snapTargets: SnapRect[];
  /** Visible siblings used to equalize spacing while dragging (no parent). */
  spacingTargets: SpacingRect[];
};

/** Every descendant box (excludes the root box itself). */
function descendantBoxes(box: LayoutBox, acc: LayoutBox[] = []): LayoutBox[] {
  for (const child of box.children) {
    acc.push(child);
    descendantBoxes(child, acc);
  }
  return acc;
}

function boxIntersectsRect(box: LayoutBox, rect: Rect): boolean {
  return (
    box.left < rect.x1 &&
    box.left + box.width > rect.x0 &&
    box.top < rect.y1 &&
    box.top + box.height > rect.y0
  );
}

function localPoint(element: HTMLDivElement, clientX: number, clientY: number): Point {
  const bounds = element.getBoundingClientRect();
  const width = Number(element.dataset.frameWidth) || bounds.width;
  const height = Number(element.dataset.frameHeight) || bounds.height;
  return {
    x: ((clientX - bounds.left) / bounds.width) * width,
    y: ((clientY - bounds.top) / bounds.height) * height,
  };
}

export function LayerOverlay({
  root,
  result,
  active,
}: {
  root: Node;
  result: LayoutReadyResult;
  active: boolean;
}) {
  const selection = useDocumentStore((state) => state.selection);
  const armedTool = useStudioStore((state) => state.armedTool);
  const armedComponentId = useStudioStore((state) => state.armedComponentId);
  const armed = armedTool !== null || armedComponentId !== null;
  const [instanceKey, setInstanceKey] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [layoutGuide, setLayoutGuide] = useState<Gesture["layoutGuide"]>(undefined);
  const [snapGuides, setSnapGuides] = useState<{ x?: number; y?: number }>({});
  const [spacingSegments, setSpacingSegments] = useState<SpacingSegment[]>([]);
  const [editing, setEditing] = useState<{ id: NodeId; value: string } | null>(null);
  const [hoveredBox, setHoveredBox] = useState<LayoutBox | null>(null);
  // True while an armed tool's cursor is over this frame — drives the "drop here"
  // ring so users know which screen the next node lands in (no pre-selection).
  const [armedHover, setArmedHover] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);

  // Selected nodes that actually live in this frame's tree.
  const selectedInRoot = useMemo(
    () => selection.filter((id) => id !== root.id && findNode(root, id)),
    [selection, root],
  );
  const isSingle = selectedInRoot.length === 1;
  const singleId = isSingle ? selectedInRoot[0] : null;
  const singleNode = singleId ? findNode(root, singleId) : undefined;

  const eventPoint = (event: React.PointerEvent<HTMLDivElement>) =>
    localPoint(overlayRef.current ?? event.currentTarget, event.clientX, event.clientY);

  // A placed ComponentInstance expands to a primitive subtree whose ids are
  // namespaced `${instanceId}::…`. Map each instance to its expanded root box so
  // it selects, outlines, and drags as a single atomic unit.
  const instanceBoxes = useMemo(() => {
    const map = new Map<NodeId, LayoutBox>();
    const walk = (box: LayoutBox) => {
      const owner = ownerInstanceId(box.node.id);
      if (owner && !map.has(owner)) map.set(owner, box); // DFS: ancestor (root) wins
      for (const child of box.children) walk(child);
    };
    walk(result.layout);
    return map;
  }, [result]);

  // Layout box for a document node id — resolves an instance to its expanded root
  // box (the instance id is not itself a snapshot key after expansion).
  function boxOf(nodeId: NodeId): LayoutBox | undefined {
    return instanceBoxes.get(nodeId) ?? result.snapshot.get(nodeId)?.[0];
  }

  // Resolve a raw layout hit (possibly expanded instance content) to the document
  // node it should act on — clicks inside an instance act on the instance itself,
  // using the instance's outer geometry.
  function resolveHit(hit: LayoutBox): LayoutBox {
    const owner = ownerInstanceId(hit.node.id);
    if (!owner) return hit;
    const docNode = findNode(root, owner);
    const instBox = instanceBoxes.get(owner);
    return docNode && instBox ? { ...instBox, node: docNode } : hit;
  }

  // Highlight box per selected node (instanceKey-matched for the single case so
  // handles track the hovered instance of a repeated node).
  const selectedBoxes = useMemo(() => {
    return selectedInRoot
      .map((id) => {
        const instBox = instanceBoxes.get(id);
        if (instBox) return instBox;
        const boxes = result.snapshot.get(id);
        if (!boxes) return undefined;
        if (isSingle) return boxes.find((b) => b.instanceKey === instanceKey) ?? boxes[0];
        return boxes[0];
      })
      .filter((b): b is LayoutBox => !!b);
  }, [selectedInRoot, result, isSingle, instanceKey, instanceBoxes]);

  const singleBox = isSingle ? selectedBoxes[0] : undefined;

  function nodeLabel(node: Node): string {
    return node.design?.name ?? node.type;
  }

  function setSelection(ids: NodeId[]) {
    useDocumentStore.getState().setSelection(ids);
  }

  function beginGesture(
    event: React.PointerEvent<HTMLDivElement>,
    box: LayoutBox,
    kind: "move" | "resize",
    handle?: ResizeHandle,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const overlay = overlayRef.current ?? event.currentTarget;
    try { overlay.setPointerCapture(event.pointerId); } catch { /* non-fatal */ }
    overlay.focus();
    const parent = getParent(root, box.node.id);
    // Capture original positions of every absolute selected node so a group drag
    // moves them all from a stable origin.
    const group: GroupMember[] = [];
    for (const id of selectedInRoot) {
      const node = findNode(root, id);
      const nodeBox = boxOf(id);
      if (node?.style.position === "absolute" && nodeBox) {
        const memberParent = getParent(root, id);
        const memberParentBox = memberParent ? boxOf(memberParent.id) : undefined;
        const borderLeft = memberParent?.style.borderLeftWidth ?? memberParent?.style.borderWidth ?? 0;
        const borderTop = memberParent?.style.borderTopWidth ?? memberParent?.style.borderWidth ?? 0;
        const style = { ...node.style };
        if (
          absoluteConstraintMode(style, "horizontal") === "start" &&
          style.left === undefined &&
          memberParentBox
        ) {
          style.left = nodeBox.left - memberParentBox.left - borderLeft;
        }
        if (
          absoluteConstraintMode(style, "vertical") === "start" &&
          style.top === undefined &&
          memberParentBox
        ) {
          style.top = nodeBox.top - memberParentBox.top - borderTop;
        }
        group.push({
          nodeId: id,
          left: nodeBox.left,
          top: nodeBox.top,
          width: nodeBox.width,
          height: nodeBox.height,
          style,
        });
      }
    }
    const groupParents = new Set(group.map((member) => getParent(root, member.nodeId)?.id));
    const snapParent = group.length > 0 && groupParents.size === 1 ? parent : undefined;
    const snapParentBox = snapParent ? boxOf(snapParent.id) : undefined;
    const selectedSet = new Set(group.map((member) => member.nodeId));
    const siblingBoxes = snapParent && snapParentBox
      ? childrenOf(snapParent)
          .filter((child) => !selectedSet.has(child.id) && !child.design?.hidden)
          .flatMap((child) => {
            const childBox = boxOf(child.id);
            return childBox ? [childBox] : [];
          })
      : [];
    // Edges/centers snap to the parent and siblings; spacing equalizes against
    // siblings only (the parent isn't a spacing neighbor).
    const snapTargets = snapParentBox ? [snapParentBox, ...siblingBoxes] : [];
    const snapBounds = group.length
      ? {
          left: Math.min(...group.map((member) => member.left)),
          top: Math.min(...group.map((member) => member.top)),
          width:
            Math.max(...group.map((member) => member.left + member.width)) -
            Math.min(...group.map((member) => member.left)),
          height:
            Math.max(...group.map((member) => member.top + member.height)) -
            Math.min(...group.map((member) => member.top)),
        }
      : undefined;
    const flexBlock =
      kind === "move" && parent && box.node.style.position !== "absolute"
        ? flexBlockInParent(root, parent.id, selectedInRoot)
        : [];
    useDocumentStore.getState().beginInteraction();
    gesture.current = {
      kind,
      pointerId: event.pointerId,
      nodeId: box.node.id,
      instanceKey: box.instanceKey,
      start: eventPoint(event),
      box,
      parentBox: parent ? boxOf(parent.id) : undefined,
      handle,
      group,
      flexBlock,
      additive: false,
      moved: false,
      layoutGuide:
        kind === "move" && box.node.style.position !== "absolute" && parent
          ? {
              box: boxOf(parent.id) ?? result.layout,
              horizontal: parent.style.flexDirection?.startsWith("row") ?? false,
            }
          : undefined,
      snapBounds,
      snapTargets,
      spacingTargets: siblingBoxes,
    };
  }

  function beginMarquee(event: React.PointerEvent<HTMLDivElement>, additive: boolean) {
    const overlay = overlayRef.current ?? event.currentTarget;
    try { overlay.setPointerCapture(event.pointerId); } catch { /* non-fatal */ }
    overlay.focus();
    const start = eventPoint(event);
    gesture.current = {
      kind: "marquee",
      pointerId: event.pointerId,
      nodeId: root.id,
      instanceKey: "",
      start,
      box: result.layout,
      group: [],
      flexBlock: [],
      additive,
      moved: false,
      snapTargets: [],
      spacingTargets: [],
    };
    setMarquee(rectOf(start, start));
  }

  function onDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!active) return;
    const point = localPoint(
      overlayRef.current ?? (event.currentTarget as HTMLDivElement),
      event.clientX,
      event.clientY,
    );
    const rawHit = hitTestLayout(result.layout, point);
    if (!rawHit) return;
    // Double-clicking inside an instance opens its definition in focus mode —
    // internals aren't document nodes, so they're edited via the component.
    const ownerId = ownerInstanceId(rawHit.node.id);
    if (ownerId) {
      const inst = findNode(root, ownerId);
      if (inst && inst.type === "ComponentInstance") {
        useDocumentStore.getState().beginComponentEdit(inst.componentId);
      }
      return;
    }
    const node = rawHit.node;
    if (node.type === "Text" && !node.design?.locked) {
      useDocumentStore.getState().setSelection([node.id]);
      setInstanceKey(rawHit.instanceKey);
      // type === "Text" guarantees TextProps at runtime; LayoutBox.node isn't
      // narrowed by the discriminant here, so read text through a narrow cast.
      setEditing({ id: node.id, value: (node.props as { text: string }).text });
    }
  }

  function commitEdit() {
    if (!editing) return;
    const node = findNode(root, editing.id);
    if (node && (node as { props?: { text?: string } }).props?.text !== editing.value) {
      try {
        useDocumentStore.getState().updateProps(root.id, editing.id, { text: editing.value });
      } catch {
        /* keep editing on invalid input */
      }
    }
    setEditing(null);
  }

  function beginCreate(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const overlay = overlayRef.current ?? event.currentTarget;
    try { overlay.setPointerCapture(event.pointerId); } catch { /* non-fatal */ }
    overlay.focus();
    const start = eventPoint(event);
    const studio = useStudioStore.getState();
    gesture.current = {
      kind: "create",
      pointerId: event.pointerId,
      nodeId: root.id,
      instanceKey: "",
      start,
      box: result.layout,
      group: [],
      flexBlock: [],
      additive: false,
      moved: false,
      createType: studio.armedTool ?? undefined,
      createComponentId: studio.armedComponentId ?? undefined,
      snapTargets: [],
      spacingTargets: [],
    };
    setMarquee(rectOf(start, start));
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!active || gesture.current || editing) return;
    const point = eventPoint(event);
    const rootOnly = selection.length === 1 && selection[0] === root.id;
    const frameEdge =
      point.x <= 8 ||
      point.y <= 8 ||
      point.x >= result.width - 8 ||
      point.y >= result.height - 8;
    // tldraw owns frame geometry. Let its edge resize targets receive the event;
    // the document overlay continues to own all inner-node interactions.
    if (rootOnly && frameEdge) return;
    // The overlay owns every pointer interaction inside an active frame; stop
    // the event here so it never reaches tldraw underneath, which would
    // otherwise translate the (selected) frame while you drag a node.
    event.stopPropagation();
    // An armed primitive or component turns the next drag into a create gesture.
    if (armed) {
      beginCreate(event);
      return;
    }
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const rawHit = hitTestLayout(result.layout, point);
    // Resolve instance internals to the placed instance so it acts atomically.
    const hit = rawHit ? resolveHit(rawHit) : undefined;

    // Empty space or the frame background → marquee (or clear when not additive).
    if (!hit || hit.node.id === root.id) {
      if (!additive) setSelection([]);
      beginMarquee(event, additive);
      return;
    }

    const store = useDocumentStore.getState();
    // Read selection fresh from the store (not the render closure) so rapid,
    // back-to-back modifier clicks compose. Exclude the frame root: a node
    // selection and the frame itself are never co-selected, so building a
    // multi-node selection drops the root the frame started out as.
    const current = store.selection.filter((id) => id !== root.id);
    if (additive) {
      // Toggle membership; don't start a drag. Falling back to the frame when
      // the last node is removed keeps a frame focused for the overlay.
      const toggled = current.includes(hit.node.id)
        ? current.filter((id) => id !== hit.node.id)
        : [...current, hit.node.id];
      const next = normalizeNodeSelection(root, toggled, { excludeRoot: true });
      store.setSelection(next.length ? next : [root.id]);
      setInstanceKey(hit.instanceKey);
      return;
    }

    // Plain click: keep an existing multi-selection if the node is part of it
    // (so the whole group can be dragged); otherwise select just this node.
    if (!current.includes(hit.node.id)) {
      store.setSelection([hit.node.id]);
    }
    setInstanceKey(hit.instanceKey);
    beginGesture(event, hit, "move");
  }

  function onResizePointerDown(
    event: React.PointerEvent<HTMLDivElement>,
    handle: ResizeHandle,
  ) {
    if (!singleBox || !singleNode || singleNode.design?.locked) return;
    beginGesture(event, singleBox, "resize", handle);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current) {
      if (!active || editing || armed) {
        setHoveredBox(null);
        return;
      }
      const rawHit = hitTestLayout(result.layout, eventPoint(event));
      const hit = rawHit ? resolveHit(rawHit) : null;
      setHoveredBox(hit && hit.node.id !== root.id && !hit.node.design?.hidden ? hit : null);
      return;
    }
    if (current.pointerId !== event.pointerId) return;
    if (hoveredBox) setHoveredBox(null);
    // Keep drag moves off tldraw so it can't translate the frame underneath.
    event.stopPropagation();
    const point = eventPoint(event);

    if (current.kind === "marquee" || current.kind === "create") {
      setMarquee(rectOf(current.start, point));
      return;
    }

    const dx = point.x - current.start.x;
    const dy = point.y - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) < 3) return;
    if (!current.moved) {
      current.moved = true;
      if (current.layoutGuide) setLayoutGuide(current.layoutGuide);
    }
    const node = findNode(root, current.nodeId);
    if (!node) return;
    const store = useDocumentStore.getState();

    if (current.kind === "resize") {
      const west = current.handle === "nw" || current.handle === "sw";
      const north = current.handle === "nw" || current.handle === "ne";
      const nextWidth = Math.max(1, current.box.width + (west ? -dx : dx));
      const nextHeight = Math.max(1, current.box.height + (north ? -dy : dy));
      const partial: Record<string, number> = { width: nextWidth, height: nextHeight };
      if (node.style.position === "absolute") {
        const parentLeft = current.parentBox?.left ?? 0;
        const parentTop = current.parentBox?.top ?? 0;
        if (west) partial.left = current.box.left - parentLeft + dx;
        if (north) partial.top = current.box.top - parentTop + dy;
      }
      store.updateStyle(root.id, node.id, partial);
      return;
    }

    // Move. Group-drag every absolute member from its captured origin.
    if (current.group.length > 0) {
      const snapped = current.snapBounds
        ? smartSnap(current.snapBounds, dx, dy, current.snapTargets)
        : { dx, dy, guideX: undefined, guideY: undefined };
      let finalDx = snapped.dx;
      let finalDy = snapped.dy;
      const segments: SpacingSegment[] = [];
      // Equalize spacing only on axes edge-snap left free, so an edge lock and a
      // spacing nudge never fight over the same axis.
      if (current.snapBounds && current.spacingTargets.length > 0) {
        const here = {
          left: current.snapBounds.left + finalDx,
          top: current.snapBounds.top + finalDy,
          width: current.snapBounds.width,
          height: current.snapBounds.height,
        };
        const spacing = equalSpacingSnap(here, current.spacingTargets);
        if (snapped.guideX === undefined && spacing.horizontal) {
          finalDx += spacing.horizontal.adjustment;
          segments.push(...spacing.horizontal.segments);
        }
        if (snapped.guideY === undefined && spacing.vertical) {
          finalDy += spacing.vertical.adjustment;
          segments.push(...spacing.vertical.segments);
        }
      }
      setSnapGuides({ x: snapped.guideX, y: snapped.guideY });
      setSpacingSegments(segments);
      for (const member of current.group) {
        store.updateStyle(root.id, member.nodeId, {
          ...absoluteMovePatch(member.style, "horizontal", finalDx),
          ...absoluteMovePatch(member.style, "vertical", finalDy),
        });
      }
    }
  }

  function finishGesture(event: React.PointerEvent<HTMLDivElement>, cancel = false) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();

    if (current.kind === "create") {
      setMarquee(null);
      setLayoutGuide(undefined);
      gesture.current = null;
      useStudioStore.getState().setArmedTool(null); // also clears any armed component
      if (!cancel && (current.createType || current.createComponentId)) {
        const store = useDocumentStore.getState();
        store.beginInteraction();
        try {
          if (current.createComponentId) {
            createDrawnComponent(current.createComponentId, current.start);
          } else if (current.createType) {
            const created = createDrawnNode(
              current.createType,
              current.start,
              rectOf(current.start, eventPoint(event)),
            );
            if (created && current.createType === "Text") {
              setEditing({ id: created, value: "Text" });
            }
          }
          store.commitInteraction();
        } catch {
          store.cancelInteraction();
        }
      }
      return;
    }

    if (current.kind === "marquee") {
      if (!cancel) {
        const rect = rectOf(current.start, eventPoint(event));
        const dragged = Math.hypot(rect.x1 - rect.x0, rect.y1 - rect.y0) >= 3;
        if (dragged) {
          const hits = descendantBoxes(result.layout)
            .filter(
              (box) =>
                !box.node.design?.hidden &&
                !box.node.design?.locked &&
                boxIntersectsRect(box, rect),
            )
            // Expanded instance internals map to their placed instance.
            .map((box) => ownerInstanceId(box.node.id) ?? box.node.id);
          const unique = [...new Set(hits)];
          // Union with the existing node selection (never the frame root).
          const base = useDocumentStore
            .getState()
            .selection.filter((id) => id !== root.id);
          const next = normalizeNodeSelection(
            root,
            current.additive ? [...base, ...unique] : unique,
            { excludeRoot: true },
          );
          setSelection(next);
        }
      }
      setMarquee(null);
      setLayoutGuide(undefined);
      gesture.current = null;
      return;
    }

    // Flex siblings dropped → reorder block (or single node) by drop position.
    if (
      !cancel &&
      current.kind === "move" &&
      current.moved &&
      current.group.length === 0 &&
      current.flexBlock.length > 0
    ) {
      const parent = getParent(root, current.flexBlock[0]);
      if (parent) {
        const siblings = childrenOf(parent).flatMap((sibling) => {
          const box = boxOf(sibling.id);
          return box ? [{ id: sibling.id, box }] : [];
        });
        const horizontal = flexFlowHorizontal(parent.style.flexDirection);
        const dropIndex = flexInsertIndex(
          siblings,
          eventPoint(event),
          horizontal,
          new Set(current.flexBlock),
        );
        reorderFlexBlock(root.id, parent.id, current.flexBlock, dropIndex);
      }
    }

    if (cancel) useDocumentStore.getState().cancelInteraction();
    else useDocumentStore.getState().commitInteraction();
    setLayoutGuide(undefined);
    setSnapGuides({});
    setSpacingSegments([]);
    gesture.current = null;
  }

  function selectParent() {
    if (!singleId || singleId === root.id) return;
    const parent = getParent(root, singleId);
    setSelection([parent?.id ?? root.id]);
    setInstanceKey(null);
  }

  /** Insert a flex-flow child at the drop index under the container at `start`. */
  function createDrawnNode(type: RNPrimitive, start: Point, rect: Rect): NodeId | null {
    const { width, height } = drawSize(rect);
    const target = containerAt(root, result.layout, start);
    try {
      const node = buildDrawnNode(type, width, height);
      const siblings = childrenOf(target.node).flatMap((sibling) => {
        const box = boxOf(sibling.id);
        return box ? [{ id: sibling.id, box }] : [];
      });
      const horizontal = flexFlowHorizontal(target.node.style.flexDirection);
      const index = flexInsertIndex(siblings, start, horizontal);
      const store = useDocumentStore.getState();
      store.insertChild(root.id, target.node.id, node, index);
      store.setSelection([node.id]);
      return node.id;
    } catch {
      return null;
    }
  }

  /** Place an instance of `componentId` at the drop index under the container at `start`. */
  function createDrawnComponent(componentId: string, start: Point): NodeId | null {
    const target = containerAt(root, result.layout, start);
    try {
      const node = createInstance(componentId);
      const siblings = childrenOf(target.node).flatMap((sibling) => {
        const box = boxOf(sibling.id);
        return box ? [{ id: sibling.id, box }] : [];
      });
      const horizontal = flexFlowHorizontal(target.node.style.flexDirection);
      const index = flexInsertIndex(siblings, start, horizontal);
      const store = useDocumentStore.getState();
      store.insertChild(root.id, target.node.id, node, index);
      store.setSelection([node.id]);
      return node.id;
    } catch {
      return null;
    }
  }

  const handles: ResizeHandle[] = ["nw", "ne", "se", "sw"];
  const handlePosition: Record<ResizeHandle, React.CSSProperties> = {
    nw: { left: -4, top: -4, cursor: "nwse-resize" },
    ne: { right: -4, top: -4, cursor: "nesw-resize" },
    se: { right: -4, bottom: -4, cursor: "nwse-resize" },
    sw: { left: -4, bottom: -4, cursor: "nesw-resize" },
  };
  const showHoverLabel =
    active &&
    hoveredBox &&
    !selectedInRoot.includes(hoveredBox.node.id) &&
    !gesture.current;
  const labelTop = (box: LayoutBox) => (box.top > 24 ? box.top - 22 : box.top + 4);
  const labelLeft = (box: LayoutBox) => Math.max(0, Math.min(box.left, result.width - 120));
  const labelStyle = (box: LayoutBox, selected = false): React.CSSProperties => ({
    position: "absolute",
    left: labelLeft(box),
    top: labelTop(box),
    maxWidth: 160,
    padding: "2px 6px",
    borderRadius: radius.xs,
    background: selected ? color.accent : color.chrome,
    boxShadow: "var(--shadow-control)",
    color: selected ? color.chrome : color.accent,
    fontFamily: font.sans,
    fontSize: text["2xs"],
    fontWeight: 600,
    lineHeight: "14px",
    overflow: "hidden",
    pointerEvents: "none",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });

  return (
    <div
      ref={overlayRef}
      data-frame-width={result.width}
      data-frame-height={result.height}
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finishGesture(event)}
      onPointerCancel={(event) => finishGesture(event, true)}
      onPointerEnter={() => { if (armed) setArmedHover(true); }}
      onPointerLeave={() => {
        setArmedHover(false);
        setHoveredBox(null);
      }}
      onDoubleClick={onDoubleClick}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !editing) selectParent();
      }}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: active ? "auto" : "none",
        outline: "none",
        cursor: armed ? "crosshair" : undefined,
      }}
    >
      {/* "Drop here" affordance: while a tool/component is armed and the cursor is
          over this frame, ring the screen so the insertion target is unambiguous. */}
      {active && armed && armedHover && (
        <div
          data-testid="armed-drop-target"
          style={{
            position: "absolute",
            inset: 0,
            border: `2px solid ${color.accent}`,
            borderRadius: radius.sm,
            background: color.accentSoft,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Flex intent is normally invisible. Reveal the active parent and its
          child slots only while a relative child is being reordered. */}
      {active && layoutGuide && (
        <div
          data-testid="layout-reflow-guide"
          style={{
            position: "absolute",
            left: layoutGuide.box.left,
            top: layoutGuide.box.top,
            width: layoutGuide.box.width,
            height: layoutGuide.box.height,
            border: `${canvasGuide.line} dashed ${color.accentLine}`,
            backgroundImage: layoutGuide.horizontal
              ? `repeating-linear-gradient(90deg, ${color.accentSoft} 0, ${color.accentSoft} ${canvasGuide.line}, transparent ${canvasGuide.line}, transparent ${canvasGuide.step})`
              : `repeating-linear-gradient(0deg, ${color.accentSoft} 0, ${color.accentSoft} ${canvasGuide.line}, transparent ${canvasGuide.line}, transparent ${canvasGuide.step})`,
            pointerEvents: "none",
          }}
        >
          {layoutGuide.box.children.map((child) => (
            <div
              key={`${child.node.id}-${child.instanceKey}`}
              style={{
                position: "absolute",
                left: child.left - layoutGuide.box.left,
                top: child.top - layoutGuide.box.top,
                width: child.width,
                height: child.height,
                outline: `${canvasGuide.line} solid ${color.accentLine}`,
                background: color.accentSoft,
              }}
            />
          ))}
        </div>
      )}

      {active && snapGuides.x !== undefined && (
        <div style={{ position: "absolute", left: snapGuides.x, top: 0, width: canvasGuide.line, height: result.height, background: color.accentLine, pointerEvents: "none" }} />
      )}
      {active && snapGuides.y !== undefined && (
        <div style={{ position: "absolute", left: 0, top: snapGuides.y, width: result.width, height: canvasGuide.line, background: color.accentLine, pointerEvents: "none" }} />
      )}

      {/* Equal-spacing distance hints — a measured rule between matched gaps. */}
      {active &&
        spacingSegments.map((seg, index) => {
          const horizontal = seg.y0 === seg.y1;
          const left = Math.min(seg.x0, seg.x1);
          const top = Math.min(seg.y0, seg.y1);
          const length = horizontal ? Math.abs(seg.x1 - seg.x0) : Math.abs(seg.y1 - seg.y0);
          return (
            <div key={`spacing-${index}`} style={{ position: "absolute", left, top, pointerEvents: "none" }}>
              {/* The rule itself. */}
              <div
                style={{
                  position: "absolute",
                  width: horizontal ? length : canvasGuide.line,
                  height: horizontal ? canvasGuide.line : length,
                  background: color.amber,
                }}
              />
              {/* End ticks. */}
              {[0, length].map((offset) => (
                <div
                  key={offset}
                  style={{
                    position: "absolute",
                    left: horizontal ? offset : -3,
                    top: horizontal ? -3 : offset,
                    width: horizontal ? canvasGuide.line : 7,
                    height: horizontal ? 7 : canvasGuide.line,
                    background: color.amber,
                  }}
                />
              ))}
              {/* Distance badge centered on the rule. */}
              <div
                style={{
                  position: "absolute",
                  left: horizontal ? length / 2 : 6,
                  top: horizontal ? 6 : length / 2,
                  transform: "translate(-50%, -50%)",
                  padding: "1px 4px",
                  borderRadius: radius.sm,
                  background: color.amber,
                  color: color.chrome,
                  fontFamily: font.mono,
                  fontSize: text.micro,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                }}
              >
                {Math.round(seg.distance)}
              </div>
            </div>
          );
        })}

      {/* Faint hover outline for discoverability without taking selection focus. */}
      {showHoverLabel && (
        <div
          data-rn-hover-outline=""
          style={{
            position: "absolute",
            left: hoveredBox.left,
            top: hoveredBox.top,
            width: hoveredBox.width,
            height: hoveredBox.height,
            border: `1px solid ${color.accentLine}`,
            borderRadius: radius.sm,
            background: color.accentSoft,
            opacity: 0.65,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Selection outlines for every selected node in this frame. */}
      {active &&
        selectedBoxes.map((box, index) => (
          <div
            key={`${box.node.id}-${index}`}
            style={{
              position: "absolute",
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              border: `1px solid ${color.accent}`,
              borderRadius: radius.sm,
              pointerEvents: "none",
            }}
          >
            {/* Resize handles only in the single-selection case. An instance's
                size comes from its definition, so it isn't directly resizable. */}
            {isSingle &&
              singleNode &&
              singleNode.id !== root.id &&
              singleNode.type !== "ComponentInstance" &&
              !singleNode.design?.locked &&
              handles.map((handle) => (
                <div
                  key={handle}
                  title={`Resize ${handle}`}
                  onPointerDown={(event) => onResizePointerDown(event, handle)}
                  style={{
                    position: "absolute",
                    width: 8,
                    height: 8,
                    border: `1px solid ${color.accent}`,
                    borderRadius: radius.sm,
                    background: color.chrome,
                    pointerEvents: "auto",
                    ...handlePosition[handle],
                  }}
                />
              ))}
          </div>
        ))}

      {/* Layer labels for selection and hover. */}
      {active &&
        selectedBoxes.map((box, index) => (
          <div
            key={`label-${box.node.id}-${index}`}
            data-rn-layer-label=""
            style={labelStyle(box, true)}
          >
            {nodeLabel(box.node)}
          </div>
        ))}
      {showHoverLabel && (
        <div data-rn-layer-label="" style={labelStyle(hoveredBox)}>
          {nodeLabel(hoveredBox.node)}
        </div>
      )}

      {/* Marquee rectangle. */}
      {active && marquee && (
        <div
          style={{
            position: "absolute",
            left: marquee.x0,
            top: marquee.y0,
            width: marquee.x1 - marquee.x0,
            height: marquee.y1 - marquee.y0,
            border: `1px solid ${color.accent}`,
            background: color.accentSoft,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Inline text editing — a textarea laid over the selected Text box. */}
      {active &&
        editing &&
        (() => {
          const box = result.snapshot.get(editing.id)?.[0];
          if (!box) return null;
          const style = box.node.style;
          return (
            <textarea
              autoFocus
              value={editing.value}
              onChange={(e) => setEditing({ id: editing.id, value: e.target.value })}
              onBlur={commitEdit}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(null);
                } else if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitEdit();
                }
              }}
              style={{
                position: "absolute",
                left: box.left,
                top: box.top,
                width: Math.max(box.width, 24),
                height: Math.max(box.height, 18),
                margin: 0,
                padding: 0,
                border: `1px solid ${color.accent}`,
                borderRadius: radius.sm,
                resize: "none",
                outline: "none",
                background: "#ffffff",
                color: typeof style.color === "string" ? style.color : "#000000",
                fontSize: typeof style.fontSize === "number" ? style.fontSize : 14,
                fontWeight: (style.fontWeight as number | undefined) ?? 400,
                lineHeight:
                  typeof style.lineHeight === "number" ? `${style.lineHeight}px` : "normal",
                textAlign: (style.textAlign as React.CSSProperties["textAlign"]) ?? "left",
                pointerEvents: "auto",
              }}
            />
          );
        })()}
    </div>
  );
}
