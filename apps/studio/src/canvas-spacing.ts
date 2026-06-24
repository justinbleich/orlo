export type SpacingRect = { left: number; top: number; width: number; height: number };

/** A measured gap to render: a line from (x0,y0)→(x1,y1) labelled with `distance`. */
export type SpacingSegment = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  distance: number;
};

/** Per-axis equalization: how far to shift, plus the equal gaps to draw. */
export type AxisSpacing = { adjustment: number; segments: SpacingSegment[] };
export type SpacingResult = { horizontal?: AxisSpacing; vertical?: AxisSpacing };

type Axis = "horizontal" | "vertical";

type Interval = { lo: number; hi: number; crossLo: number; crossHi: number };

function interval(rect: SpacingRect, axis: Axis): Interval {
  return axis === "horizontal"
    ? { lo: rect.left, hi: rect.left + rect.width, crossLo: rect.top, crossHi: rect.top + rect.height }
    : { lo: rect.top, hi: rect.top + rect.height, crossLo: rect.left, crossHi: rect.left + rect.width };
}

/** True when two ranges overlap (touching edges count as overlap). */
function overlaps(aLo: number, aHi: number, bLo: number, bHi: number): boolean {
  return aLo <= bHi && bLo <= aHi;
}

/** Build a renderable gap segment between two points on `axis` at cross position `cross`. */
function segment(axis: Axis, from: number, to: number, cross: number, distance: number): SpacingSegment {
  return axis === "horizontal"
    ? { x0: from, y0: cross, x1: to, y1: cross, distance }
    : { x0: cross, y0: from, x1: cross, y1: to, distance };
}

/**
 * On one axis, equalize the gap between `moving` and its nearest siblings on
 * either side. Only siblings sharing a band on the cross axis are considered, so
 * the measured gaps are the ones a designer actually sees between the items.
 */
function axisSpacing(
  moving: SpacingRect,
  siblings: readonly SpacingRect[],
  axis: Axis,
  threshold: number,
): AxisSpacing | undefined {
  const m = interval(moving, axis);
  const banded = siblings
    .map((rect) => interval(rect, axis))
    .filter((sib) => overlaps(m.crossLo, m.crossHi, sib.crossLo, sib.crossHi));

  let prev: Interval | undefined;
  let next: Interval | undefined;
  for (const sib of banded) {
    if (sib.hi <= m.lo && (!prev || sib.hi > prev.hi)) prev = sib;
    if (sib.lo >= m.hi && (!next || sib.lo < next.lo)) next = sib;
  }
  if (!prev || !next) return undefined;

  // Shift so gap-before equals gap-after: solve (m.lo+adj - prev.hi) = (next.lo - (m.hi+adj)).
  const adjustment = (next.lo - m.hi - (m.lo - prev.hi)) / 2;
  if (Math.abs(adjustment) > threshold) return undefined;

  const distance = m.lo + adjustment - prev.hi;
  if (distance < 0) return undefined; // overlapping, not a real gap

  const lo = m.lo + adjustment;
  const hi = m.hi + adjustment;
  const crossBefore = (Math.max(m.crossLo, prev.crossLo) + Math.min(m.crossHi, prev.crossHi)) / 2;
  const crossAfter = (Math.max(m.crossLo, next.crossLo) + Math.min(m.crossHi, next.crossHi)) / 2;
  return {
    adjustment,
    segments: [
      segment(axis, prev.hi, lo, crossBefore, distance),
      segment(axis, hi, next.lo, crossAfter, distance),
    ],
  };
}

/**
 * Equal-spacing snap: when the moving rect sits between two siblings on an axis,
 * nudge it (within `threshold`) so the gaps match, and return the gaps to draw.
 * Axes are independent; either, both, or neither may equalize.
 */
export function equalSpacingSnap(
  moving: SpacingRect,
  siblings: readonly SpacingRect[],
  threshold = 4,
): SpacingResult {
  return {
    horizontal: axisSpacing(moving, siblings, "horizontal", threshold),
    vertical: axisSpacing(moving, siblings, "vertical", threshold),
  };
}
