import { useMemo, useRef, useState } from "react";
import {
  childrenOf,
  findNode,
  getParent,
  useDocumentStore,
  type Node,
  type NodeId,
} from "@rn-canvas/document";
import type { LayoutBox, LayoutReadyResult } from "@rn-canvas/render-web";
import { color, radius } from "./studio-theme";

type Point = { x: number; y: number };
type Rect = { x0: number; y0: number; x1: number; y1: number };
type ResizeHandle = "nw" | "ne" | "se" | "sw";
type GroupMember = { nodeId: NodeId; left: number; top: number };
type Gesture = {
  kind: "move" | "resize" | "marquee";
  pointerId: number;
  nodeId: NodeId;
  instanceKey: string;
  start: Point;
  box: LayoutBox;
  parentBox?: LayoutBox;
  handle?: ResizeHandle;
  /** Absolute-positioned selected nodes moved together during a group drag. */
  group: GroupMember[];
  additive: boolean;
  moved: boolean;
};

function contains(box: LayoutBox, point: Point): boolean {
  return (
    point.x >= box.left &&
    point.x <= box.left + box.width &&
    point.y >= box.top &&
    point.y <= box.top + box.height
  );
}

/** Deepest visible/unlocked document box at a frame-local point. */
export function hitTestLayout(box: LayoutBox, point: Point): LayoutBox | undefined {
  if (box.node.design?.hidden || box.node.design?.locked || !contains(box, point)) {
    return undefined;
  }
  for (let index = box.children.length - 1; index >= 0; index -= 1) {
    const hit = hitTestLayout(box.children[index], point);
    if (hit) return hit;
  }
  return box;
}

/** Every descendant box (excludes the root box itself). */
function descendantBoxes(box: LayoutBox, acc: LayoutBox[] = []): LayoutBox[] {
  for (const child of box.children) {
    acc.push(child);
    descendantBoxes(child, acc);
  }
  return acc;
}

function rectOf(a: Point, b: Point): Rect {
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
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

function firstBox(result: LayoutReadyResult, nodeId: NodeId): LayoutBox | undefined {
  return result.snapshot.get(nodeId)?.[0];
}

export function RNNodeOverlay({
  root,
  result,
  active,
}: {
  root: Node;
  result: LayoutReadyResult;
  active: boolean;
}) {
  const selection = useDocumentStore((state) => state.selection);
  const [instanceKey, setInstanceKey] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [editing, setEditing] = useState<{ id: NodeId; value: string } | null>(null);
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

  // Highlight box per selected node (instanceKey-matched for the single case so
  // handles track the hovered instance of a repeated node).
  const selectedBoxes = useMemo(() => {
    return selectedInRoot
      .map((id) => {
        const boxes = result.snapshot.get(id);
        if (!boxes) return undefined;
        if (isSingle) return boxes.find((b) => b.instanceKey === instanceKey) ?? boxes[0];
        return boxes[0];
      })
      .filter((b): b is LayoutBox => !!b);
  }, [selectedInRoot, result, isSingle, instanceKey]);

  const singleBox = isSingle ? selectedBoxes[0] : undefined;

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
    overlay.setPointerCapture(event.pointerId);
    overlay.focus();
    const parent = getParent(root, box.node.id);
    // Capture original positions of every absolute selected node so a group drag
    // moves them all from a stable origin.
    const group: GroupMember[] = [];
    for (const id of selectedInRoot) {
      const node = findNode(root, id);
      const nodeBox = firstBox(result, id);
      if (node?.style.position === "absolute" && nodeBox) {
        group.push({ nodeId: id, left: nodeBox.left, top: nodeBox.top });
      }
    }
    useDocumentStore.getState().beginInteraction();
    gesture.current = {
      kind,
      pointerId: event.pointerId,
      nodeId: box.node.id,
      instanceKey: box.instanceKey,
      start: eventPoint(event),
      box,
      parentBox: parent ? firstBox(result, parent.id) : undefined,
      handle,
      group,
      additive: false,
      moved: false,
    };
  }

  function beginMarquee(event: React.PointerEvent<HTMLDivElement>, additive: boolean) {
    const overlay = overlayRef.current ?? event.currentTarget;
    overlay.setPointerCapture(event.pointerId);
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
      additive,
      moved: false,
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
    const hit = hitTestLayout(result.layout, point);
    if (!hit) return;
    const node = hit.node;
    if (node.type === "Text" && !node.design?.locked) {
      useDocumentStore.getState().setSelection([node.id]);
      setInstanceKey(hit.instanceKey);
      // type === "Text" guarantees TextProps at runtime; LayoutBox.node isn't
      // narrowed by the discriminant here, so read text through a narrow cast.
      setEditing({ id: node.id, value: (node.props as { text: string }).text });
    }
  }

  function commitEdit() {
    if (!editing) return;
    const node = findNode(root, editing.id);
    if (node && (node.props as { text?: string }).text !== editing.value) {
      try {
        useDocumentStore.getState().updateProps(root.id, editing.id, { text: editing.value });
      } catch {
        /* keep editing on invalid input */
      }
    }
    setEditing(null);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!active || gesture.current || editing) return;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const hit = hitTestLayout(result.layout, eventPoint(event));

    // Empty space or the frame background → marquee (or clear when not additive).
    if (!hit || hit.node.id === root.id) {
      if (!additive) setSelection([]);
      beginMarquee(event, additive);
      return;
    }

    const store = useDocumentStore.getState();
    // Read selection fresh from the store (not the render closure) so rapid,
    // back-to-back modifier clicks compose instead of clobbering each other.
    const current = store.selection;
    if (additive) {
      // Toggle membership; don't start a drag.
      const next = current.includes(hit.node.id)
        ? current.filter((id) => id !== hit.node.id)
        : [...current, hit.node.id];
      store.setSelection(next);
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
    if (!current || current.pointerId !== event.pointerId) return;
    const point = eventPoint(event);

    if (current.kind === "marquee") {
      setMarquee(rectOf(current.start, point));
      return;
    }

    const dx = point.x - current.start.x;
    const dy = point.y - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) < 3) return;
    current.moved = true;
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
      for (const member of current.group) {
        const memberNode = findNode(root, member.nodeId);
        const parent = memberNode ? getParent(root, member.nodeId) : undefined;
        const parentBox = parent ? firstBox(result, parent.id) : undefined;
        const parentLeft = parentBox?.left ?? 0;
        const parentTop = parentBox?.top ?? 0;
        store.updateStyle(root.id, member.nodeId, {
          left: member.left - parentLeft + dx,
          top: member.top - parentTop + dy,
        });
      }
    }
  }

  function finishGesture(event: React.PointerEvent<HTMLDivElement>, cancel = false) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();

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
            .map((box) => box.node.id);
          const unique = [...new Set(hits)];
          const next = current.additive
            ? [...new Set([...useDocumentStore.getState().selection, ...unique])]
            : unique;
          setSelection(next);
        }
      }
      setMarquee(null);
      gesture.current = null;
      return;
    }

    // Single flex node dropped → reorder among siblings by midpoint.
    if (!cancel && current.kind === "move" && current.moved && current.group.length === 0) {
      const node = findNode(root, current.nodeId);
      const parent = node ? getParent(root, node.id) : undefined;
      if (node && parent && node.style.position !== "absolute") {
        const siblings = childrenOf(parent);
        const from = siblings.findIndex((sibling) => sibling.id === node.id);
        const horizontal = parent.style.flexDirection?.startsWith("row") ?? false;
        const point = eventPoint(event);
        const coordinate = horizontal ? point.x : point.y;
        let to = siblings.length - 1;
        for (let index = 0; index < siblings.length; index += 1) {
          const box = firstBox(result, siblings[index].id);
          if (!box) continue;
          const midpoint = horizontal ? box.left + box.width / 2 : box.top + box.height / 2;
          if (coordinate < midpoint) {
            to = index;
            break;
          }
        }
        if (from >= 0 && to !== from) {
          useDocumentStore.getState().reorderChild(root.id, parent.id, from, to);
        }
      }
    }

    if (cancel) useDocumentStore.getState().cancelInteraction();
    else useDocumentStore.getState().commitInteraction();
    gesture.current = null;
  }

  function selectParent() {
    if (!singleId || singleId === root.id) return;
    const parent = getParent(root, singleId);
    setSelection([parent?.id ?? root.id]);
    setInstanceKey(null);
  }

  const handles: ResizeHandle[] = ["nw", "ne", "se", "sw"];
  const handlePosition: Record<ResizeHandle, React.CSSProperties> = {
    nw: { left: -4, top: -4, cursor: "nwse-resize" },
    ne: { right: -4, top: -4, cursor: "nesw-resize" },
    se: { right: -4, bottom: -4, cursor: "nwse-resize" },
    sw: { left: -4, bottom: -4, cursor: "nesw-resize" },
  };

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
      onDoubleClick={onDoubleClick}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !editing) selectParent();
      }}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: active ? "auto" : "none",
        outline: "none",
      }}
    >
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
            {/* Resize handles only in the single-selection case. */}
            {isSingle &&
              singleNode &&
              singleNode.id !== root.id &&
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
