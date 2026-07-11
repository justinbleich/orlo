import assert from "node:assert/strict";
import test from "node:test";
import {
  toComponentDisplayPath,
  toComponentFileName,
  toPascalName,
} from "./component-name";

test("component names preserve display paths and emit safe file names", () => {
  assert.equal(toPascalName("primary button"), "PrimaryButton");
  assert.equal(toComponentDisplayPath("button.primary", "Component"), "Button.Primary");
  assert.equal(toComponentFileName("Button.Primary"), "ButtonPrimary");
});

test("component display paths fall back to PascalCase defaults", () => {
  assert.equal(toComponentDisplayPath("", "pressable component"), "PressableComponent");
  assert.equal(toComponentDisplayPath("button..primary", "Component"), "Button.Primary");
  assert.equal(toComponentDisplayPath("2fa.button", "Component"), "C2fa.Button");
});
