import assert from "node:assert/strict";
import { test } from "node:test";
import { alignmentDeltas, distributionDeltas, type ArrangeBox } from "./canvas-arrange";

const boxes: ArrangeBox[] = [
  { id: "a", left: 10, top: 10, width: 20, height: 10 },
  { id: "b", left: 50, top: 30, width: 10, height: 20 },
  { id: "c", left: 100, top: 20, width: 20, height: 10 },
];

test("alignment deltas target shared edges and centers", () => {
  assert.deepEqual([...alignmentDeltas(boxes, "horizontal", "start")], [
    ["a", 0], ["b", -40], ["c", -90],
  ]);
  assert.deepEqual([...alignmentDeltas(boxes, "vertical", "center")], [
    ["a", 15], ["b", -10], ["c", 5],
  ]);
});

test("distribution preserves outer items and equalizes gaps", () => {
  assert.deepEqual([...distributionDeltas(boxes, "horizontal")], [
    ["a", 0], ["b", 10], ["c", 0],
  ]);
});
