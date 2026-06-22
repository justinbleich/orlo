import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStyle, assertStyle } from "./validate";
import { pickVisualStyle } from "./yoga-map";
import { createCanvasTextMeasurer } from "./text-measure";

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
