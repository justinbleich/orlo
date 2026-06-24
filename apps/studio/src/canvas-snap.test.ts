import assert from "node:assert/strict";
import { test } from "node:test";
import { smartSnap } from "./canvas-snap";

test("smartSnap aligns moving edges and centers within threshold", () => {
  const moving = { left: 10, top: 10, width: 20, height: 20 };
  const target = { left: 50, top: 50, width: 20, height: 20 };
  assert.deepEqual(smartSnap(moving, 18, 19, [target]), {
    dx: 20,
    dy: 20,
    guideX: 50,
    guideY: 50,
  });
});

test("smartSnap leaves motion untouched outside threshold", () => {
  const result = smartSnap(
    { left: 0, top: 0, width: 10, height: 10 },
    11,
    12,
    [{ left: 50, top: 50, width: 10, height: 10 }],
  );
  assert.deepEqual(result, { dx: 11, dy: 12, guideX: undefined, guideY: undefined });
});
