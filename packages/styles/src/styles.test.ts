import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStyle, assertStyle } from "./validate";
import { pickVisualStyle } from "./yoga-map";
import { sizingMode, sizingPatch } from "./sizing";
import {
  absoluteConstraintMode,
  absoluteConstraintPatch,
  absoluteEdgePatch,
  absoluteMovePatch,
} from "./constraints";
import {
  createCanvasTextMeasurer,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_METRICS,
} from "./text-measure";

test("accepts a valid RN style", () => {
  const result = validateStyle({
    flexDirection: "row",
    padding: 16,
    width: "50%",
    height: "auto",
    backgroundColor: "#fff",
    fontWeight: "600",
    transform: [{ scale: 1.2 }, { rotate: "45deg" }],
  });
  assert.equal(result.ok, true);
});

test("rejects unit strings", () => {
  const result = validateStyle({ width: "10px" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors[0].key, "width");
    assert.match(result.errors[0].reason, /unit strings/);
  }
});

test("accepts auto only for Yoga-supported dimensions", () => {
  assert.equal(validateStyle({ width: "auto", marginLeft: "auto" }).ok, true);
  assert.equal(validateStyle({ padding: "auto" }).ok, false);
  assert.equal(validateStyle({ top: "auto" }).ok, false);
  assert.equal(validateStyle({ minWidth: "auto" }).ok, false);
});

test("main-axis sizing maps hug, fill, and fixed to Yoga flex styles", () => {
  const parent = { flexDirection: "row" as const, alignItems: "center" as const };
  assert.deepEqual(sizingPatch({ width: 80 }, "horizontal", "fill", parent), {
    width: undefined,
    flex: 1,
    flexGrow: undefined,
    flexBasis: undefined,
  });
  assert.equal(sizingMode({ flex: 1 }, "horizontal", parent), "fill");
  assert.equal(sizingMode({}, "horizontal", parent), "hug");
  assert.equal(sizingMode({ width: 80 }, "horizontal", parent), "fixed");
});

test("cross-axis hug overrides an implicitly stretching parent", () => {
  const parent = { flexDirection: "column" as const };
  assert.equal(sizingMode({}, "horizontal", parent), "fill");
  assert.deepEqual(sizingPatch({}, "horizontal", "hug", parent), {
    width: undefined,
    alignSelf: "flex-start",
  });
  assert.equal(sizingMode({ alignSelf: "flex-start" }, "horizontal", parent), "hug");
});

test("absolute edge constraints preserve the current geometry", () => {
  const geometry = { parentStart: 20, parentSize: 300, start: 70, size: 80 };
  assert.deepEqual(absoluteConstraintPatch("horizontal", "start", geometry), {
    left: 50,
    right: undefined,
    width: 80,
  });
  assert.deepEqual(absoluteConstraintPatch("horizontal", "end", geometry), {
    left: undefined,
    right: 170,
    width: 80,
  });
  assert.deepEqual(absoluteConstraintPatch("horizontal", "stretch", geometry), {
    left: 50,
    right: 170,
    width: undefined,
  });
});

test("absolute constraint mode reads canonical RN edge combinations", () => {
  assert.equal(absoluteConstraintMode({ left: 12, width: 80 }, "horizontal"), "start");
  assert.equal(absoluteConstraintMode({ right: 12, width: 80 }, "horizontal"), "end");
  assert.equal(absoluteConstraintMode({ left: 12, right: 12 }, "horizontal"), "stretch");
});

test("manual absolute edge edits enter and leave stretch canonically", () => {
  assert.deepEqual(absoluteEdgePatch({ left: 10, width: 80 }, "horizontal", "end", 20), {
    right: 20,
    width: undefined,
  });
  assert.deepEqual(
    absoluteEdgePatch({ left: 10, right: 20 }, "horizontal", "end", undefined, 270),
    { right: undefined, width: 270 },
  );
});

test("absolute movement preserves start, end, and stretch pin modes", () => {
  assert.deepEqual(absoluteMovePatch({ left: 10 }, "horizontal", 5), { left: 15 });
  assert.deepEqual(absoluteMovePatch({ right: 10 }, "horizontal", 5), { right: 5 });
  assert.deepEqual(absoluteMovePatch({ left: 10, right: 20 }, "horizontal", 5), {
    left: 15,
    right: 15,
  });
});

test("rejects CSS shorthand", () => {
  const result = validateStyle({ margin: "10px 20px" });
  assert.equal(result.ok, false);
});

test("rejects web-only properties with a hint", () => {
  const result = validateStyle({ boxShadow: "0 0 4px #000", display: "grid" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    const boxShadow = result.errors.find((e) => e.key === "boxShadow");
    assert.ok(boxShadow);
    assert.match(boxShadow!.reason, /shadowColor/);
  }
});

test("rejects unknown enum values", () => {
  const result = validateStyle({ flexDirection: "diagonal" });
  assert.equal(result.ok, false);
});

test("rejects malformed transform ops", () => {
  assert.equal(validateStyle({ transform: [{ rotate: 45 }] }).ok, false);
  assert.equal(validateStyle({ transform: { scale: 1 } }).ok, false);
});

test("assertStyle throws on invalid input", () => {
  assert.throws(() => assertStyle({ width: "10px" }), /Invalid RNStyle/);
  assert.doesNotThrow(() => assertStyle({ width: 100 }));
});

test("pickVisualStyle keeps paint keys and drops pure layout", () => {
  const visual = pickVisualStyle({
    width: 100,
    padding: 8,
    backgroundColor: "#abc",
    borderWidth: 1,
    flexDirection: "row",
  });
  assert.deepEqual(Object.keys(visual).sort(), ["backgroundColor", "borderWidth"]);
});

test("text measurer returns positive size and grows with line count", () => {
  const m = createCanvasTextMeasurer();
  const one = m.measure({ text: "Hello", style: { fontSize: 16 } });
  assert.ok(one.width > 0 && one.height > 0);
  const wrapped = m.measure({
    text: "the quick brown fox jumps over the lazy dog",
    style: { fontSize: 16 },
    maxWidth: 60,
  });
  assert.ok(wrapped.height > one.height);
});

test("text measurer respects numberOfLines clamp", () => {
  const m = createCanvasTextMeasurer();
  const clamped = m.measure({
    text: "a b c d e f g h i j k l m n o p",
    style: { fontSize: 16 },
    maxWidth: 30,
    numberOfLines: 2,
  });
  const unclamped = m.measure({
    text: "a b c d e f g h i j k l m n o p",
    style: { fontSize: 16 },
    maxWidth: 30,
  });
  assert.ok(clamped.height < unclamped.height);
});

test("default text uses pinned Inter metrics", () => {
  const m = createCanvasTextMeasurer();
  const measured = m.measure({ text: "Pinned", style: { fontSize: 14 } });
  const metrics = DEFAULT_FONT_METRICS[DEFAULT_FONT_FAMILY];

  assert.equal(
    measured.height,
    Math.ceil(14 * (metrics.ascent + metrics.descent + metrics.lineGap)),
  );
  assert.equal(measured.height, 17);
});

test("pinned metrics produce deterministic wrapping and line height", () => {
  const measure = () =>
    createCanvasTextMeasurer().measure({
      text: "one two three four",
      style: { fontFamily: DEFAULT_FONT_FAMILY, fontSize: 16 },
      maxWidth: 55,
    });

  assert.deepEqual(measure(), measure());
  assert.equal(measure().height % 20, 0);
});
