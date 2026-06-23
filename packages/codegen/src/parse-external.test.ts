import assert from "node:assert/strict";
import { test } from "node:test";
import { childrenOf, validateTree, type Node } from "@rn-canvas/document";
import { emitScreen } from "./emit";
import { parseExternalScreen } from "./parse-external";

const fullTree: Node = {
  id: "root",
  type: "View",
  props: {},
  style: {
    width: 390,
    minHeight: 640,
    padding: 16,
    gap: 12,
    backgroundColor: "#ffffff",
  },
  children: [
    {
      id: "text",
      type: "Text",
      props: { text: "External <RN> {screen}", numberOfLines: 2 },
      style: {
        fontFamily: "Inter",
        fontSize: 18,
        fontWeight: "600",
        color: "#111111",
      },
    },
    {
      id: "image-uri",
      type: "Image",
      props: { source: { uri: "https://example.com/image.png" }, resizeMode: "contain" },
      style: { width: 80, height: 80 },
    },
    {
      id: "image-require",
      type: "Image",
      props: { source: { require: "./asset.png" }, resizeMode: "cover" },
      style: { width: 40, height: 40 },
    },
    {
      id: "pressable",
      type: "Pressable",
      props: { disabled: true },
      style: { padding: 8, borderRadius: 6 },
      children: [
        {
          id: "pressable-text",
          type: "Text",
          props: { text: "Disabled" },
          style: { color: "#222222" },
        },
      ],
    },
    {
      id: "scroll",
      type: "ScrollView",
      props: { horizontal: true, showsScrollIndicator: false },
      style: { height: 100 },
      children: [
        { id: "scroll-view", type: "View", props: {}, style: { width: 200 }, children: [] },
      ],
    },
    {
      id: "input",
      type: "TextInput",
      props: {
        placeholder: "Email",
        value: "hello@example.com",
        editable: false,
        secureTextEntry: true,
        keyboardType: "email-address",
      },
      style: { borderWidth: 1, paddingHorizontal: 8 },
    },
    {
      id: "list",
      type: "FlatList",
      props: { data: [{ id: 1 }, { id: 2 }], horizontal: true },
      style: { flex: 1 },
      children: [
        {
          id: "row",
          type: "View",
          props: {},
          style: { padding: 4 },
          children: [
            { id: "row-text", type: "Text", props: { text: "Row" }, style: {} },
          ],
        },
      ],
    },
  ],
};

function typesIn(root: Node): string[] {
  return [root.type, ...childrenOf(root).flatMap(typesIn)];
}

test("imports the exact static subset emitted by codegen", () => {
  const source = emitScreen(fullTree, { screenName: "ImportedScreen" });
  const parsed = parseExternalScreen(source, { idPrefix: "external" });

  assert.equal(parsed.screenName, "ImportedScreen");
  assert.deepEqual(validateTree(parsed.root), []);
  assert.deepEqual(typesIn(parsed.root), typesIn(fullTree));
  assert.equal(parsed.root.id, "external-0");
  assert.equal(emitScreen(parsed.root, { screenName: parsed.screenName }), source);
});

test("imports static inline RN styles", () => {
  const parsed = parseExternalScreen(`
    import { StyleSheet, Text, View } from "react-native";
    export default function Inline() {
      return <View style={{ padding: 12 }}><Text style={{ fontSize: 16 }}>Hello</Text></View>;
    }
    const styles = StyleSheet.create({});
  `);

  assert.equal(parsed.root.style.padding, 12);
  const child = childrenOf(parsed.root)[0];
  assert.equal(child.type, "Text");
  assert.equal(child.style.fontSize, 16);
});

test("fails closed for dynamic styles and unknown props", () => {
  assert.throws(
    () =>
      parseExternalScreen(`
        import { View } from "react-native";
        export default function Dynamic() {
          const width = 100;
          return <View style={{ width }} />;
        }
      `),
    /dynamic expression|object methods/,
  );

  assert.throws(
    () =>
      parseExternalScreen(`
        import { View } from "react-native";
        export default function Unknown() { return <View className="web" />; }
      `),
    /unknown View prop className/,
  );
});

test("rejects RNStyle values outside the supported contract", () => {
  assert.throws(
    () =>
      parseExternalScreen(`
        import { View } from "react-native";
        export default function Grid() { return <View style={{ display: "grid" }} />; }
      `),
    /Invalid imported RN tree/,
  );
});
