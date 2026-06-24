import type { RNStyle } from "./types";
import type { PhysicalAxis } from "./sizing";

export type AbsoluteConstraintMode = "start" | "end" | "stretch";
export type AbsoluteEdge = "start" | "end";

export type AxisGeometry = {
  parentStart: number;
  parentSize: number;
  parentStartInset?: number;
  parentEndInset?: number;
  start: number;
  size: number;
};

function keys(axis: PhysicalAxis) {
  return axis === "horizontal"
    ? ({ start: "left", end: "right", size: "width" } as const)
    : ({ start: "top", end: "bottom", size: "height" } as const);
}

export function absoluteConstraintMode(
  style: RNStyle,
  axis: PhysicalAxis,
): AbsoluteConstraintMode {
  const key = keys(axis);
  if (style[key.start] !== undefined && style[key.end] !== undefined) return "stretch";
  if (style[key.end] !== undefined) return "end";
  return "start";
}

/** Convert an absolute child to an edge-pin mode without moving its current Yoga box. */
export function absoluteConstraintPatch(
  axis: PhysicalAxis,
  mode: AbsoluteConstraintMode,
  geometry: AxisGeometry,
): Partial<RNStyle> {
  const key = keys(axis);
  const visualStart = geometry.start - geometry.parentStart;
  const start = Math.round(visualStart - (geometry.parentStartInset ?? 0));
  const end = Math.round(
    geometry.parentSize -
      (geometry.parentEndInset ?? 0) -
      visualStart -
      geometry.size,
  );
  const size = Math.round(geometry.size);

  if (mode === "start") {
    return { [key.start]: start, [key.end]: undefined, [key.size]: size };
  }
  if (mode === "end") {
    return { [key.start]: undefined, [key.end]: end, [key.size]: size };
  }
  return { [key.start]: start, [key.end]: end, [key.size]: undefined };
}

/** Keep manual edge edits canonical: two pins stretch; one pin keeps a fixed size. */
export function absoluteEdgePatch(
  style: RNStyle,
  axis: PhysicalAxis,
  edge: AbsoluteEdge,
  value: number | undefined,
  currentSize?: number,
): Partial<RNStyle> {
  const key = keys(axis);
  const editedKey = edge === "start" ? key.start : key.end;
  const oppositeKey = edge === "start" ? key.end : key.start;
  const oppositePinned = style[oppositeKey] !== undefined;
  const patch: Partial<RNStyle> = { [editedKey]: value };
  if (value !== undefined && oppositePinned) patch[key.size] = undefined;
  if (value === undefined && oppositePinned && style[key.size] === undefined) {
    patch[key.size] = Math.round(currentSize ?? (axis === "horizontal" ? 100 : 40));
  }
  return patch;
}

/** Translate an absolute child while preserving its current edge-pin mode. */
export function absoluteMovePatch(
  style: RNStyle,
  axis: PhysicalAxis,
  delta: number,
): Partial<RNStyle> {
  const key = keys(axis);
  const mode = absoluteConstraintMode(style, axis);
  if (mode === "end") return { [key.end]: (Number(style[key.end]) || 0) - delta };
  if (mode === "stretch") {
    return {
      [key.start]: (Number(style[key.start]) || 0) + delta,
      [key.end]: (Number(style[key.end]) || 0) - delta,
    };
  }
  return { [key.start]: (Number(style[key.start]) || 0) + delta };
}
