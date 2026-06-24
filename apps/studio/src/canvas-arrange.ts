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
