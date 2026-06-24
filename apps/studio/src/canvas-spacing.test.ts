import assert from "node:assert/strict";
import { test } from "node:test";
import { equalSpacingSnap } from "./canvas-spacing";

test("equalizes the gap between two horizontal neighbors", () => {
  const prev = { left: 0, top: 0, width: 20, height: 20 };
  const next = { left: 120, top: 0, width: 20, height: 20 };
  // Moving sits at left=58 → gap-before 38, gap-after 42; shift +2 makes both 40.
  const moving = { left: 58, top: 0, width: 20, height: 20 };
  const result = equalSpacingSnap(moving, [prev, next]);
  assert.equal(result.horizontal?.adjustment, 2);
  assert.deepEqual(
    result.horizontal?.segments.map((s) => s.distance),
    [40, 40],
  );
  // First gap spans prev.right(20) → moving.left(60) at the shared vertical band center.
  assert.deepEqual(result.horizontal?.segments[0], { x0: 20, y0: 10, x1: 60, y1: 10, distance: 40 });
  assert.equal(result.vertical, undefined);
});

test("ignores siblings outside the cross-axis band", () => {
  const prev = { left: 0, top: 0, width: 20, height: 20 };
  const next = { left: 120, top: 200, width: 20, height: 20 }; // different row
  const moving = { left: 58, top: 0, width: 20, height: 20 };
  assert.equal(equalSpacingSnap(moving, [prev, next]).horizontal, undefined);
});

test("leaves spacing untouched beyond threshold", () => {
  const prev = { left: 0, top: 0, width: 20, height: 20 };
  const next = { left: 120, top: 0, width: 20, height: 20 };
  const moving = { left: 40, top: 0, width: 20, height: 20 }; // needs +20 to equalize
  assert.equal(equalSpacingSnap(moving, [prev, next], 4).horizontal, undefined);
});
