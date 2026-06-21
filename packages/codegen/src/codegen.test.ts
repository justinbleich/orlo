import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "@babel/parser";
import { createNode } from "@rn-canvas/document";
import { emitScreen, generateScreen, parseSidecar } from "./index";

/** Assert emitted source parses as valid TS+JSX ("compiles" per BUILD Phase 3). */
function assertParses(code: string) {
  assert.doesNotThrow(() =>
    parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] }),
  );
}

function card() {
  return createNode("View", {
    style: { flexDirection: "row", padding: 16, backgroundColor: "#fff" },
    children: [
      createNode("Text", {
        props: { text: "Hello RN Canvas" },
        style: { fontSize: 18, color: "#111" },
      }),
      createNode("Image", {
        props: { source: { uri: "https://x/y.png" }, resizeMode: "contain" },
        style: { width: 48, height: 48 },
      }),
    ],
  });
}

test("emits an idiomatic RN screen that parses", () => {
  const code = emitScreen(card(), { screenName: "Card" });
  assert.match(code, /import \{[^}]*\} from "react-native"/);
  assert.match(code, /export default function Card\(\)/);
  assert.match(code, /StyleSheet\.create\(/);
  assert.match(code, /Hello RN Canvas/);
  assert.match(code, /flexDirection: "row"/);
  assert.match(code, /source=\{\{\s*uri: "https:\/\/x\/y\.png"\s*\}\}/);
  assertParses(code);
});

test("imports exactly the components used, plus StyleSheet", () => {
  const code = emitScreen(card(), { screenName: "Card" });
  const imports = code.match(/import \{([^}]*)\} from "react-native"/)![1];
  const names = imports.split(",").map((s) => s.trim()).sort();
  assert.deepEqual(names, ["Image", "StyleSheet", "Text", "View"]);
});

test("design metadata is never emitted to code, only to the sidecar", () => {
  const root = createNode("View", {
    design: { name: "SecretFrame" },
    children: [
      createNode("Text", {
        props: { text: "Body" },
        design: { name: "SecretLabel", locked: true, annotations: [{ id: "a", text: "todo" }] },
      }),
    ],
  });
  const { code, sidecar } = generateScreen(root, { screenName: "Screen" });

  for (const leak of ["SecretFrame", "SecretLabel", "locked", "annotations", "design", "todo"]) {
    assert.ok(!code.includes(leak), `code must not contain "${leak}"`);
  }
  assert.ok(sidecar.includes("SecretLabel"));
  assert.ok(sidecar.includes("todo"));
});

test("hidden nodes are omitted from code but kept in the sidecar", () => {
  const root = createNode("View", {
    children: [
      createNode("Text", { props: { text: "visible" } }),
      createNode("Text", { props: { text: "ghost" }, design: { hidden: true } }),
    ],
  });
  const { code, sidecar } = generateScreen(root);
  assert.ok(code.includes("visible"));
  assert.ok(!code.includes("ghost"), "hidden node must not render in code");
  assert.ok(sidecar.includes("ghost"), "hidden node must persist in the sidecar");
});

test("emits all v1 primitives and parses", () => {
  const root = createNode("View", {
    children: [
      createNode("Text", { props: { text: "t" } }),
      createNode("Image", { props: { source: { uri: "u" } } }),
      createNode("Pressable", {}),
      createNode("ScrollView", { props: { horizontal: true } }),
      createNode("TextInput", { props: { placeholder: "name", secureTextEntry: true } }),
      createNode("FlatList", {
        props: { data: [{ id: "1" }, { id: "2" }] },
        children: [createNode("Text", { props: { text: "row" } })],
      }),
    ],
  });
  const code = emitScreen(root);
  assertParses(code);
  assert.match(code, /data=\{\[/);
  assert.match(code, /renderItem=\{\(\) =>/);
  assert.match(code, /keyExtractor=/);
});

test("sidecar round-trips to an identical tree", () => {
  const root = card();
  const { sidecar, screenName } = generateScreen(root, { screenName: "Card" });
  const parsed = parseSidecar(sidecar);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.screenName, "Card");
  assert.deepEqual(parsed.root, root);
  assert.equal(screenName, "Card");
});
