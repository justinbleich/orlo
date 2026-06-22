import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { parse } from "@babel/parser";
import {
  RN_PRIMITIVES,
  createNode,
  validateTree,
  type DesignMeta,
  type Node,
} from "@rn-canvas/document";
import { ALL_STYLE_KEYS, type RNStyle, type StyleKey } from "@rn-canvas/styles";
import fc from "fast-check";
import { generateScreen, parseSidecar } from "./index";

const execFileAsync = promisify(execFile);
const DESIGN_SENTINEL = "__RN_CANVAS_DESIGN_ONLY__";

const STYLE_VALUES: Record<StyleKey, readonly unknown[]> = {
  flexDirection: ["row", "column", "row-reverse", "column-reverse"],
  justifyContent: ["flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly"],
  alignItems: ["flex-start", "flex-end", "center", "stretch", "baseline"],
  alignSelf: ["auto", "flex-start", "flex-end", "center", "stretch", "baseline"],
  flexWrap: ["wrap", "nowrap", "wrap-reverse"],
  flex: [1, 0, -1],
  flexGrow: [1, 0],
  flexShrink: [1, 0],
  flexBasis: [20, "25%", "auto"],
  gap: [8, 0],
  rowGap: [6, 0],
  columnGap: [4, 0],
  width: [120, "50%", "auto"],
  height: [80, "40%", "auto"],
  minWidth: [10, "10%"],
  maxWidth: [320, "90%"],
  minHeight: [10, "10%"],
  maxHeight: [640, "90%"],
  aspectRatio: [1, 1.5],
  position: ["relative", "absolute"],
  top: [4, "5%"],
  right: [4, "5%"],
  bottom: [4, "5%"],
  left: [4, "5%"],
  zIndex: [1, 0, -1],
  padding: [8, "5%"],
  paddingHorizontal: [8, "5%"],
  paddingVertical: [8, "5%"],
  paddingTop: [8, "5%"],
  paddingRight: [8, "5%"],
  paddingBottom: [8, "5%"],
  paddingLeft: [8, "5%"],
  margin: [8, "5%", "auto"],
  marginHorizontal: [8, "5%", "auto"],
  marginVertical: [8, "5%", "auto"],
  marginTop: [8, "5%", "auto"],
  marginRight: [8, "5%", "auto"],
  marginBottom: [8, "5%", "auto"],
  marginLeft: [8, "5%", "auto"],
  borderWidth: [1, 0],
  borderTopWidth: [1, 0],
  borderRightWidth: [1, 0],
  borderBottomWidth: [1, 0],
  borderLeftWidth: [1, 0],
  borderColor: ["#123456", "transparent"],
  borderRadius: [8, 0],
  borderTopLeftRadius: [8, 0],
  borderTopRightRadius: [8, 0],
  borderBottomLeftRadius: [8, 0],
  borderBottomRightRadius: [8, 0],
  backgroundColor: ["#abcdef", "transparent"],
  color: ["#111111", "white"],
  fontFamily: ["Inter", "system-ui"],
  fontSize: [16, 12],
  fontWeight: ["normal", "bold", "100", "400", "900"],
  fontStyle: ["normal", "italic"],
  lineHeight: [20, 16],
  letterSpacing: [0, 1],
  textAlign: ["auto", "left", "right", "center", "justify"],
  textTransform: ["none", "uppercase", "lowercase", "capitalize"],
  textDecorationLine: ["none", "underline", "line-through", "underline line-through"],
  opacity: [1, 0.5, 0],
  shadowColor: ["#000000", "transparent"],
  shadowOffset: [{ width: 0, height: 2 }, { width: -1, height: 1 }],
  shadowOpacity: [0.2, 0],
  shadowRadius: [4, 0],
  elevation: [2, 0],
  overflow: ["visible", "hidden", "scroll"],
  transform: [
    [{ translateX: 4 }, { scale: 1.2 }, { rotate: "15deg" }],
    [{ skewX: "5deg" }, { translateY: -2 }],
  ],
};

const styleEntries = Object.entries(STYLE_VALUES) as Array<[
  StyleKey,
  readonly unknown[],
]>;
const styleEntryArbitrary = fc.oneof(
  ...styleEntries.map(([key, values]) =>
    fc.tuple(fc.constant(key), fc.constantFrom(...values)),
  ),
);
const styleArbitrary = fc
  .uniqueArray(styleEntryArbitrary, {
    maxLength: 14,
    selector: ([key]) => key,
  })
  .map((entries) => Object.fromEntries(entries) as RNStyle);

const designArbitrary = fc.option(
  fc.record({
    name: fc.uuid().map((id) => `${DESIGN_SENTINEL}${id}`),
    locked: fc.boolean(),
    hidden: fc.boolean(),
    annotations: fc.array(
      fc.record({
        id: fc.uuid(),
        text: fc.uuid().map((id) => `${DESIGN_SENTINEL}${id}`),
      }),
      { maxLength: 2 },
    ),
  }),
  { nil: undefined },
);

const optional = <T>(arbitrary: fc.Arbitrary<T>) =>
  fc.option(arbitrary, { nil: undefined });
const smallText = fc.string({ maxLength: 32 });
const sampleValue = fc.oneof(
  fc.string({ maxLength: 16 }),
  fc.integer({ min: -100, max: 100 }),
  fc.boolean(),
  fc.constant(null),
  fc.record({ id: fc.integer({ min: 0, max: 100 }), label: smallText }),
);

function nodeArbitrary(depth: number): fc.Arbitrary<Node> {
  const common = fc.tuple(styleArbitrary, designArbitrary);
  const text = fc
    .tuple(
      common,
      smallText,
      optional(fc.integer({ min: 0, max: 8 })),
    )
    .map(([[style, design], value, numberOfLines]) =>
      createNode("Text", {
        style,
        design,
        props: { text: value, numberOfLines },
      }),
    );
  const image = fc
    .tuple(
      common,
      fc.oneof(
        smallText.map((uri) => ({ uri })),
        fc.constant({ require: "./asset.png" }),
      ),
      optional(fc.constantFrom("cover", "contain", "stretch", "center", "repeat")),
    )
    .map(([[style, design], source, resizeMode]) =>
      createNode("Image", { style, design, props: { source, resizeMode } }),
    );
  const textInput = fc
    .tuple(
      common,
      optional(smallText),
      optional(smallText),
      optional(fc.boolean()),
      optional(fc.boolean()),
      optional(fc.constantFrom("default", "numeric", "email-address", "phone-pad")),
    )
    .map(([[style, design], placeholder, value, secureTextEntry, editable, keyboardType]) =>
      createNode("TextInput", {
        style,
        design,
        props: { placeholder, value, secureTextEntry, editable, keyboardType },
      }),
    );

  const child = depth > 0 ? nodeArbitrary(depth - 1) : fc.oneof(text, image, textInput);
  const view = fc
    .tuple(common, fc.array(child, { maxLength: 3 }))
    .map(([[style, design], children]) => createNode("View", { style, design, children }));
  const pressable = fc
    .tuple(common, optional(fc.boolean()), fc.array(child, { maxLength: 2 }))
    .map(([[style, design], disabled, children]) =>
      createNode("Pressable", { style, design, props: { disabled }, children }),
    );
  const scrollView = fc
    .tuple(
      common,
      optional(fc.boolean()),
      optional(fc.boolean()),
      fc.array(child, { maxLength: 2 }),
    )
    .map(([[style, design], horizontal, showsScrollIndicator, children]) =>
      createNode("ScrollView", {
        style,
        design,
        props: { horizontal, showsScrollIndicator },
        children,
      }),
    );
  const flatList = fc
    .tuple(
      common,
      fc.array(sampleValue, { maxLength: 3 }),
      optional(fc.boolean()),
      optional(child),
    )
    .map(([[style, design], data, horizontal, template]) =>
      createNode("FlatList", {
        style,
        design,
        props: { data, horizontal },
        children: template ? [template] : [],
      }),
    );

  return fc.oneof(text, image, textInput, view, pressable, scrollView, flatList);
}

const fullStyle = Object.fromEntries(
  styleEntries.map(([key, values]) => [key, values[0]]),
) as RNStyle;

function contractDocument(): Node {
  return createNode("View", {
    style: fullStyle,
    children: [
      createNode("Text", { props: { text: "Text", numberOfLines: 2 } }),
      createNode("Image", {
        props: { source: { require: "./asset.png" }, resizeMode: "repeat" },
      }),
      createNode("Pressable", { props: { disabled: true } }),
      createNode("ScrollView", {
        props: { horizontal: true, showsScrollIndicator: false },
      }),
      createNode("TextInput", {
        props: {
          placeholder: "Email",
          value: "a@example.com",
          secureTextEntry: true,
          editable: false,
          keyboardType: "email-address",
        },
      }),
      createNode("FlatList", {
        props: { data: [{ id: "1" }], horizontal: true },
        children: [createNode("Text", { props: { text: "Row" } })],
      }),
    ],
  });
}

async function assertGeneratedSourcesTypecheck(sources: string[]) {
  const directory = await mkdtemp(join(process.cwd(), ".generated-typecheck-"));
  try {
    await Promise.all(
      sources.map((source, index) =>
        writeFile(join(directory, `Screen${index}.tsx`), `${source}\n`),
      ),
    );
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          jsx: "react-jsx",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          esModuleInterop: true,
        },
        include: ["*.tsx"],
      }),
    );
    try {
      await execFileAsync(
        "pnpm",
        ["exec", "tsc", "--project", join(directory, "tsconfig.json")],
        { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 },
      );
    } catch (error) {
      const result = error as { stdout?: string; stderr?: string };
      throw new Error(`Generated RN failed typecheck:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("contract corpus covers every primitive and RNStyle key", async () => {
  assert.deepEqual(new Set(Object.keys(STYLE_VALUES)), new Set(ALL_STYLE_KEYS));
  const root = contractDocument();
  assert.deepEqual(validateTree(root), []);
  const generated = generateScreen(root, { screenName: "ContractScreen" });
  for (const primitive of RN_PRIMITIVES) assert.ok(generated.code.includes(primitive));
  for (const key of ALL_STYLE_KEYS) assert.ok(generated.code.includes(key));
  assert.deepEqual(parseSidecar(generated.sidecar).root, root);
  parse(generated.code, { sourceType: "module", plugins: ["jsx", "typescript"] });
  await assertGeneratedSourcesTypecheck([generated.code]);
});

test("arbitrary valid documents generate type-safe RN and identical sidecars", async () => {
  const sources: string[] = [];
  fc.assert(
    fc.property(nodeArbitrary(3), (root) => {
      assert.deepEqual(validateTree(root), []);
      const generated = generateScreen(root, { screenName: `PropertyScreen${sources.length}` });
      assert.doesNotThrow(() =>
        parse(generated.code, { sourceType: "module", plugins: ["jsx", "typescript"] }),
      );
      assert.deepEqual(parseSidecar(generated.sidecar).root, root);
      assert.ok(!generated.code.includes(DESIGN_SENTINEL));
      sources.push(generated.code);
    }),
    { numRuns: 100, seed: 20260621 },
  );
  await assertGeneratedSourcesTypecheck(sources);
});
