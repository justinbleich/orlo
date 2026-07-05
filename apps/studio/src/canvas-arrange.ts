import type { NodeId } from "@rn-canvas/document";
import type { PhysicalAxis } from "@rn-canvas/styles";

export type ArrangeAlignment = "start" | "center" | "end";
export type ArrangeBox = {
  id: NodeId;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CanvasManifestPositions = Record<NodeId, { x: number; y: number }>;
export type CanvasManifestFlowPositions = Record<string, CanvasManifestPositions>;
export type FrameSize = { width: number; height: number };
export type FramePosition = { x: number; y: number };

function start(box: ArrangeBox, axis: PhysicalAxis): number {
  return axis === "horizontal" ? box.left : box.top;
}

function size(box: ArrangeBox, axis: PhysicalAxis): number {
  return axis === "horizontal" ? box.width : box.height;
}

export function alignmentDeltas(
  boxes: readonly ArrangeBox[],
  axis: PhysicalAxis,
  alignment: ArrangeAlignment,
): Map<NodeId, number> {
  if (boxes.length < 2) return new Map();
  const starts = boxes.map((box) => start(box, axis));
  const ends = boxes.map((box) => start(box, axis) + size(box, axis));
  const min = Math.min(...starts);
  const max = Math.max(...ends);
  const target = alignment === "start" ? min : alignment === "end" ? max : (min + max) / 2;
  return new Map(
    boxes.map((box) => {
      const anchor =
        alignment === "start"
          ? start(box, axis)
          : alignment === "end"
            ? start(box, axis) + size(box, axis)
            : start(box, axis) + size(box, axis) / 2;
      return [box.id, target - anchor];
    }),
  );
}

export function distributionDeltas(
  boxes: readonly ArrangeBox[],
  axis: PhysicalAxis,
): Map<NodeId, number> {
  if (boxes.length < 3) return new Map();
  const ordered = [...boxes].sort((a, b) => start(a, axis) - start(b, axis));
  const first = start(ordered[0], axis);
  const lastEnd = start(ordered[ordered.length - 1], axis) + size(ordered[ordered.length - 1], axis);
  const totalSize = ordered.reduce((sum, box) => sum + size(box, axis), 0);
  const gap = (lastEnd - first - totalSize) / (ordered.length - 1);
  let cursor = first;
  const deltas = new Map<NodeId, number>();
  for (const box of ordered) {
    deltas.set(box.id, cursor - start(box, axis));
    cursor += size(box, axis) + gap;
  }
  return deltas;
}

export function pruneCanvasManifest(
  positions: CanvasManifestPositions,
  flowPositions: CanvasManifestFlowPositions,
  knownRootIds: ReadonlySet<NodeId>,
  knownFlowIds: ReadonlySet<string>,
) {
  const nextPositions: CanvasManifestPositions = {};
  for (const [rootId, position] of Object.entries(positions)) {
    if (knownRootIds.has(rootId)) nextPositions[rootId] = position;
  }

  const nextFlowPositions: CanvasManifestFlowPositions = {};
  for (const [flowId, byRoot] of Object.entries(flowPositions)) {
    if (!knownFlowIds.has(flowId)) continue;
    const nextByRoot: CanvasManifestPositions = {};
    for (const [rootId, position] of Object.entries(byRoot)) {
      if (knownRootIds.has(rootId)) nextByRoot[rootId] = position;
    }
    if (Object.keys(nextByRoot).length > 0) nextFlowPositions[flowId] = nextByRoot;
  }

  return { positions: nextPositions, flowPositions: nextFlowPositions };
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function nextFreeFramePosition(
  occupied: readonly Array<FramePosition & FrameSize>,
  frame: FrameSize,
  gutter: number,
  origin: FramePosition,
  columns = 3,
): FramePosition {
  const columnCount = Math.max(1, Math.floor(columns));
  const slotWidth = frame.width + gutter;
  const slotHeight = frame.height + gutter;
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = {
      x: origin.x + (index % columnCount) * slotWidth,
      y: origin.y + Math.floor(index / columnCount) * slotHeight,
      width: frame.width,
      height: frame.height,
    };
    if (!occupied.some((box) => intersects(candidate, box))) {
      return { x: candidate.x, y: candidate.y };
    }
  }
  return {
    x: origin.x,
    y: origin.y + Math.ceil(occupied.length / columnCount) * slotHeight,
  };
}
