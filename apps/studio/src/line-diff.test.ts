import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLineDiff } from "./line-diff";

test("identical text has no changes", () => {
  const { rows, added, removed } = computeLineDiff("a\nb\nc", "a\nb\nc");
  assert.equal(added, 0);
  assert.equal(removed, 0);
  assert.ok(rows.every((r) => r.type === "context"));
});

test("counts added and removed lines", () => {
  const { added, removed } = computeLineDiff("a\nb\nc", "a\nB\nc\nd");
  // b -> B is one removal + one addition; d is one addition.
  assert.equal(removed, 1);
  assert.equal(added, 2);
});

test("empty baseline treats everything as additions", () => {
  const { added, removed, rows } = computeLineDiff("", "x\ny");
  assert.equal(added, 2);
  assert.equal(removed, 0);
  assert.ok(rows.every((r) => r.type === "add"));
});

test("preserves line numbers on context and edits", () => {
  const { rows } = computeLineDiff("keep\nold", "keep\nnew");
  const context = rows.find((r) => r.text === "keep");
  const del = rows.find((r) => r.type === "del");
  const add = rows.find((r) => r.type === "add");
  assert.equal(context?.oldNumber, 1);
  assert.equal(context?.newNumber, 1);
  assert.equal(del?.oldNumber, 2);
  assert.equal(add?.newNumber, 2);
});
