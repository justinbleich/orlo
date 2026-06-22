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
type ResizeHandle = "nw" | "ne" | "se" | "sw";
type Gesture = {
  kind: "move" | "resize";
  pointerId: number;
  nodeId: NodeId;
  instanceKey: string;
  start: Point;
  box: LayoutBox;
  parentBox?: LayoutBox;
  handle?: ResizeHandle;
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
  const selectedId = selection[0] ?? null;
  const selectedNode = selectedId ? findNode(root, selectedId) : undefined;
  const [instanceKey, setInstanceKey] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);

  const eventPoint = (event: React.PointerEvent<HTMLDivElement>) =>
    localPoint(overlayRef.current ?? event.currentTarget, event.clientX, event.clientY);

  const selectedBox = useMemo(() => {
    if (!selectedId) return undefined;
    const boxes = result.snapshot.get(selectedId);
    return boxes?.find((box) => box.instanceKey === instanceKey) ?? boxes?.[0];
  }, [instanceKey, result, selectedId]);

  function beginGesture(
    event: React.PointerEvent<HTMLDivElement>,
    box: LayoutBox,
    kind: Gesture["kind"],
    handle?: ResizeHandle,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const overlay = overlayRef.current ?? event.currentTarget;
    overlay.setPointerCapture(event.pointerId);
    overlay.focus();
    const parent = getParent(root, box.node.id);
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
      moved: false,
    };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!active || gesture.current) return;
    const hit = hitTestLayout(result.layout, eventPoint(event));
    if (!hit) return;
    const store = useDocumentStore.getState();
    store.setSelection([hit.node.id]);
    setInstanceKey(hit.instanceKey);
    if (hit.node.id === root.id) return;
    beginGesture(event, hit, "move");
  }

  function onResizePointerDown(
    event: React.PointerEvent<HTMLDivElement>,
    handle: ResizeHandle,
  ) {
    if (!selectedBox || !selectedNode || selectedNode.design?.locked) return;
    beginGesture(event, selectedBox, "resize", handle);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const point = eventPoint(event);
    const dx = point.x - current.start.x;
    const dy = point.y - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) < 3) return;
    current.moved = true;
    const node = findNode(root, current.nodeId);
    if (!node) return;

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
      useDocumentStore.getState().updateStyle(root.id, node.id, partial);
      return;
    }

    if (node.style.position === "absolute") {
      const parentLeft = current.parentBox?.left ?? 0;
      const parentTop = current.parentBox?.top ?? 0;
      useDocumentStore.getState().updateStyle(root.id, node.id, {
        left: current.box.left - parentLeft + dx,
        top: current.box.top - parentTop + dy,
      });
    }
  }

  function finishGesture(event: React.PointerEvent<HTMLDivElement>, cancel = false) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();

    if (!cancel && current.kind === "move" && current.moved) {
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
          const midpoint = horizontal
            ? box.left + box.width / 2
            : box.top + box.height / 2;
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
    if (!selectedId || selectedId === root.id) return;
    const parent = getParent(root, selectedId);
    useDocumentStore.getState().setSelection([parent?.id ?? root.id]);
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
      onKeyDown={(event) => {
        if (event.key === "Escape") selectParent();
      }}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: active ? "auto" : "none",
        outline: "none",
      }}
    >
      {active && selectedBox && selectedNode && (
        <div
          style={{
            position: "absolute",
            left: selectedBox.left,
            top: selectedBox.top,
            width: selectedBox.width,
            height: selectedBox.height,
            border: `1px solid ${color.accent}`,
            borderRadius: radius.sm,
            pointerEvents: "none",
          }}
        >
          {selectedNode.id !== root.id &&
            !selectedNode.design?.locked &&
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
      )}
    </div>
  );
}
