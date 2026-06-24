export type SnapRect = { left: number; top: number; width: number; height: number };
export type SnapResult = { dx: number; dy: number; guideX?: number; guideY?: number };

function anchors(start: number, size: number): number[] {
  return [start, start + size / 2, start + size];
}

function nearestAdjustment(moving: number[], targets: number[], threshold: number) {
  let best: { adjustment: number; guide: number } | undefined;
  for (const source of moving) {
    for (const target of targets) {
      const adjustment = target - source;
      if (Math.abs(adjustment) <= threshold && (!best || Math.abs(adjustment) < Math.abs(best.adjustment))) {
        best = { adjustment, guide: target };
      }
    }
  }
  return best;
}

export function smartSnap(
  moving: SnapRect,
  dx: number,
  dy: number,
  targets: readonly SnapRect[],
  threshold = 4,
): SnapResult {
  const targetXs = targets.flatMap((target) => anchors(target.left, target.width));
  const targetYs = targets.flatMap((target) => anchors(target.top, target.height));
  const x = nearestAdjustment(anchors(moving.left + dx, moving.width), targetXs, threshold);
  const y = nearestAdjustment(anchors(moving.top + dy, moving.height), targetYs, threshold);
  return {
    dx: dx + (x?.adjustment ?? 0),
    dy: dy + (y?.adjustment ?? 0),
    guideX: x?.guide,
    guideY: y?.guide,
  };
}
