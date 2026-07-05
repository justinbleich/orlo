import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alignmentDeltas,
  distributionDeltas,
  nextFreeFramePosition,
  pruneCanvasManifest,
  type ArrangeBox,
} from "./canvas-arrange";

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

test("pruneCanvasManifest drops ghost roots and stale flow positions", () => {
  assert.deepEqual(
    pruneCanvasManifest(
      {
        "root-a": { x: 10, y: 20 },
        "ghost-root": { x: 80, y: 80 },
        "root-b": { x: 30, y: 40 },
      },
      {
        flow: {
          "root-a": { x: 100, y: 120 },
          "ghost-root": { x: 80, y: 80 },
        },
        "old-flow": {
          "root-b": { x: 300, y: 320 },
        },
      },
      new Set(["root-a", "root-b"]),
      new Set(["flow"]),
    ),
    {
      positions: {
        "root-a": { x: 10, y: 20 },
        "root-b": { x: 30, y: 40 },
      },
      flowPositions: {
        flow: {
          "root-a": { x: 100, y: 120 },
        },
      },
    },
  );
});

test("nextFreeFramePosition picks the first non-overlapping grid slot", () => {
  const frame = { width: 100, height: 200 };
  assert.deepEqual(
    nextFreeFramePosition(
      [
        { x: 80, y: 80, ...frame },
        { x: 200, y: 80, ...frame },
      ],
      frame,
      20,
      { x: 80, y: 80 },
      3,
    ),
    { x: 320, y: 80 },
  );
});

test("nextFreeFramePosition advances rows and honors non-default frame sizes", () => {
  const frame = { width: 120, height: 220 };
  const occupied = [
    { x: 80, y: 80, ...frame },
    { x: 250, y: 80, ...frame },
    { x: 80, y: 350, ...frame },
  ];
  const first = nextFreeFramePosition(occupied, frame, 50, { x: 80, y: 80 }, 2);
  assert.deepEqual(first, { x: 250, y: 350 });

  const second = nextFreeFramePosition(
    [...occupied, { ...first, ...frame }],
    frame,
    50,
    { x: 80, y: 80 },
    2,
  );
  assert.deepEqual(second, { x: 80, y: 620 });
});
