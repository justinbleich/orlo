import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "@babel/parser";
import { childrenOf, createNode, updateStyle, type Node } from "@rn-canvas/document";
import { absoluteConstraintPatch, sizingPatch } from "@rn-canvas/styles";
import { emitScreen, generateScreen, generateScreens, parseSidecar } from "./index";

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
      createNode("Text", { props: { text: "t", numberOfLines: 2 } }),
      createNode("Image", {
        props: { source: { uri: "u" }, resizeMode: "contain" },
      }),
      createNode("Pressable", { props: { disabled: true } }),
      createNode("ScrollView", {
        props: { horizontal: true, showsScrollIndicator: false },
      }),
      createNode("TextInput", {
        props: {
          placeholder: "name",
          value: "Ada",
          secureTextEntry: true,
          editable: false,
          keyboardType: "email-address",
        },
      }),
      createNode("FlatList", {
        props: { data: [{ id: "1" }, { id: "2" }], horizontal: true },
        children: [createNode("Text", { props: { text: "row" } })],
      }),
    ],
  });
  const code = emitScreen(root);
  assertParses(code);
  assert.match(code, /data=\{\[/);
  assert.match(code, /renderItem=\{\(\) =>/);
  assert.match(code, /keyExtractor=/);
  assert.match(code, /numberOfLines=\{2\}/);
  assert.match(code, /disabled/);
  assert.match(code, /showsHorizontalScrollIndicator=\{false\}/);
  assert.match(code, /value=\{"Ada"\}/);
  assert.match(code, /editable=\{false\}/);
  assert.match(code, /keyboardType=\{"email-address"\}/);
});

test("emits require image sources and vertical scroll indicators", () => {
  const root = createNode("View", {
    children: [
      createNode("Image", { props: { source: { require: "./asset.png" } } }),
      createNode("ScrollView", { props: { showsScrollIndicator: false } }),
    ],
  });
  const code = emitScreen(root);
  assert.match(code, /require\("\.\/asset\.png"\)/);
  assert.match(code, /showsVerticalScrollIndicator=\{false\}/);
  assertParses(code);
});

test("a hidden root emits no render tree but remains in the sidecar", () => {
  const root = createNode("View", {
    design: { hidden: true, name: "HiddenRoot" },
    children: [createNode("Text", { props: { text: "secret body" } })],
  });
  const { code, sidecar } = generateScreen(root);
  assert.match(code, /return null/);
  assert.ok(!code.includes("secret body"));
  assert.ok(!code.includes("HiddenRoot"));
  assert.ok(sidecar.includes("HiddenRoot"));
  assertParses(code);
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

test("sidecar parser rejects an invalid document tree", () => {
  assert.throws(
    () =>
      parseSidecar(
        JSON.stringify({
          version: 1,
          screenName: "Broken",
          root: { ...card(), style: { width: "320px" } },
        }),
      ),
    /Invalid .rncanvas.json sidecar/,
  );
});

test("pages generate as independent React Navigation-ready screen stubs", () => {
  const home = card();
  const screens = generateScreens([
    { screenName: "HomeScreen", root: home },
    { screenName: "ProfileScreen", root: createNode("View") },
  ]);

  assert.deepEqual(screens.map((screen) => screen.screenName), [
    "HomeScreen",
    "ProfileScreen",
  ]);
  assert.match(screens[0].code, /export default function HomeScreen\(\)/);
  assert.match(screens[1].code, /export default function ProfileScreen\(\)/);
  assert.ok(screens.every((screen) => !/react-router|window\.|document\./.test(screen.code)));
  assert.deepEqual(parseSidecar(screens[0].sidecar).root, home);
  assertParses(screens[0].code);
  assertParses(screens[1].code);
});

test("multi-screen generation rejects duplicate route names", () => {
  assert.throws(
    () =>
      generateScreens([
        { screenName: "HomeScreen", root: card() },
        { screenName: "HomeScreen", root: createNode("View") },
      ]),
    /Duplicate screen name/,
  );
});

test("emits Phase 2B flex + absolute styles through the real style authority", () => {
  // A row auto-layout container, as the auto-layout panel writes it.
  const rowParent = { flexDirection: "row" as const };
  let root = createNode("View", {
    style: {
      flexDirection: "row",
      gap: 12,
      padding: 16,
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
    },
    children: [
      createNode("Text", { props: { text: "Fill" } }),
      createNode("Text", { props: { text: "Fixed" } }),
      createNode("View", { style: { position: "absolute" } }),
    ],
  });
  const [fillId, fixedId, absId] = childrenOf(root).map((c) => c.id);

  // Per-child sizing via the styles authority (not hand-written keys):
  // main-axis Fill → flex:1; main-axis Fixed → width; cross-axis Fill → stretch.
  const styleOf = (tree: Node, id: string) => childrenOf(tree).find((c) => c.id === id)!.style;
  root = updateStyle(root, fillId, sizingPatch(styleOf(root, fillId), "horizontal", "fill", rowParent));
  root = updateStyle(root, fixedId, sizingPatch(styleOf(root, fixedId), "horizontal", "fixed", rowParent, 80));
  root = updateStyle(root, fixedId, sizingPatch(styleOf(root, fixedId), "vertical", "fill", rowParent));

  // Absolute edge pins: a left pin horizontally (start), a bottom pin vertically
  // (end). Each single-edge pin keeps its explicit size (only a two-pin stretch
  // drops it), so this child carries width + left and height + bottom.
  const geometry = (start: number, size: number) => ({
    parentStart: 0,
    parentSize: 320,
    start,
    size,
  });
  root = updateStyle(root, absId, absoluteConstraintPatch("horizontal", "start", geometry(24, 100)));
  root = updateStyle(root, absId, absoluteConstraintPatch("vertical", "end", geometry(40, 60)));

  const code = emitScreen(root, { screenName: "Layout" });
  assertParses(code);

  // Flex container surface lands verbatim in the StyleSheet.
  assert.match(code, /flexDirection: "row"/);
  assert.match(code, /gap: 12/);
  assert.match(code, /justifyContent: "space-between"/);
  assert.match(code, /flexWrap: "wrap"/);
  // Sizing modes: fill is flex:1, cross-fill is alignSelf stretch, fixed keeps width.
  assert.match(code, /flex: 1/);
  assert.match(code, /alignSelf: "stretch"/);
  assert.match(code, /width: 80/);
  // Absolute single-edge pins: left+width horizontally, bottom+height vertically.
  assert.match(code, /position: "absolute"/);
  assert.match(code, /left: 24/);
  assert.match(code, /width: 100/);
  assert.match(code, /bottom: 220/);
  assert.match(code, /height: 60/);

  // The merge path strips cleared keys, so no `undefined`/`null` leaks into output.
  assert.ok(!/:\s*undefined/.test(code), "no undefined values in emitted styles");
  assert.ok(!/:\s*null/.test(code), "no null values in emitted styles");
  // Main-axis Fill clears the explicit width; cross-axis Fill clears the height.
  const fillNode = childrenOf(root).find((c) => c.id === fillId)!;
  const fixedNode = childrenOf(root).find((c) => c.id === fixedId)!;
  const absNode = childrenOf(root).find((c) => c.id === absId)!;
  assert.equal(fillNode.style.width, undefined);
  assert.equal(fixedNode.style.height, undefined);
  // End pin keeps its size and clears the opposite (top) edge.
  assert.equal(absNode.style.height, 60);
  assert.equal(absNode.style.top, undefined);
});

test("multi-screen generation rejects names that cannot be stable identifiers", () => {
  assert.throws(
    () => generateScreens([{ screenName: "home screen", root: card() }]),
    /Invalid screen name/,
  );
});

import { createInstance, type ComponentDefinition, type ComponentRegistry } from "@rn-canvas/document";
import { buildSidecar, emitComponent, serializeSidecar } from "./index";

function cardDefinition(): ComponentDefinition {
  return {
    id: "card1",
    name: "Card",
    template: createNode("View", {
      id: "card",
      style: { flexDirection: "row" },
      children: [
        createNode("Text", { id: "title", props: { text: "Title" }, style: { color: "#111111" } }),
        createNode("View", { id: "icon", style: { backgroundColor: "#000000", width: 10, height: 10 } }),
        createNode("View", { id: "slot" }),
      ],
    }),
    props: [
      { name: "title", valueType: "string", default: "Title", targets: [{ kind: "prop", nodeId: "title", path: "text" }] },
      { name: "tint", valueType: "color", targets: [
        { kind: "style", nodeId: "title", styleKey: "color" },
        { kind: "style", nodeId: "icon", styleKey: "backgroundColor" },
      ] },
      { name: "showIcon", valueType: "boolean", default: true, targets: [{ kind: "visibility", nodeId: "icon" }] },
      { name: "body", valueType: "node", targets: [{ kind: "slot", nodeId: "slot" }] },
    ],
  };
}

test("emitComponent emits a typed component with prop substitutions", () => {
  const { name, fileName, code } = emitComponent(cardDefinition(), { card1: cardDefinition() });
  assert.equal(name, "Card");
  assert.equal(fileName, "Card.tsx");
  assertParses(code);
  // Typed props interface; node/defaulted props optional.
  assert.match(code, /interface CardProps/);
  assert.match(code, /title\?: string/);
  assert.match(code, /tint: string/);
  assert.match(code, /showIcon\?: boolean/);
  assert.match(code, /body\?: ReactNode/);
  assert.match(code, /import type \{ ReactNode \} from "react"/);
  // Defaults become default params.
  assert.match(code, /title = "Title"/);
  assert.match(code, /showIcon = true/);
  // Substitutions: text → {title}; multi-target color → both nodes reference tint;
  // visibility guard; slot → {body}.
  assert.match(code, /\{title\}/);
  assert.match(code, /color: tint/);
  assert.match(code, /backgroundColor: tint/);
  assert.match(code, /showIcon && <View/);
  assert.match(code, /\{body\}/);
});

test("a screen emits instances as parameterized usages + a component import", () => {
  const registry: ComponentRegistry = { card1: cardDefinition() };
  const screen = createNode("View", {
    id: "screen",
    children: [
      { ...createInstance("card1", { id: "i1" }), overrides: { title: "One", tint: "#ff0000" } },
      { ...createInstance("card1", { id: "i2" }), overrides: { title: "Two", showIcon: false } },
    ],
  });
  const gen = generateScreen(screen, { screenName: "Home", components: registry });
  assertParses(gen.code);
  assert.match(gen.code, /import \{ Card \} from "\.\/components\/Card"/);
  assert.match(gen.code, /<Card title=\{"One"\} tint=\{"#ff0000"\} \/>/);
  assert.match(gen.code, /<Card title=\{"Two"\} showIcon=\{false\} \/>/);
  // No style attr on the usage; screen StyleSheet carries only screen-level layout.
  assert.ok(!/Card[^>]*style=/.test(gen.code));
  // The used component is emitted as its own module.
  assert.deepEqual(gen.components.map((c) => c.fileName), ["Card.tsx"]);
  assertParses(gen.components[0].code);
});

test("a nested instance pulls in its sub-component module", () => {
  const card = cardDefinition();
  const outer: ComponentDefinition = {
    id: "outer1",
    name: "Banner",
    template: createNode("View", {
      id: "banner",
      children: [{ ...createInstance("card1", { id: "inner" }), overrides: { title: "Hi" } }],
    }),
    props: [],
  };
  const registry: ComponentRegistry = { card1: card, outer1: outer };
  // Banner's module imports Card from a sibling module.
  const bannerModule = emitComponent(outer, registry);
  assert.match(bannerModule.code, /import \{ Card \} from "\.\/Card"/);
  assert.match(bannerModule.code, /<Card title=\{"Hi"\} \/>/);
  // A screen using Banner emits both component modules.
  const screen = createNode("View", { id: "s", children: [createInstance("outer1", { id: "b1" })] });
  const gen = generateScreen(screen, { screenName: "Home", components: registry });
  assert.deepEqual(gen.components.map((c) => c.name).sort(), ["Banner", "Card"]);
});

test("the sidecar round-trips the component registry", () => {
  const registry: ComponentRegistry = { card1: cardDefinition() };
  const screen = createNode("View", { id: "s", children: [createInstance("card1", { id: "i1" })] });
  const sidecar = serializeSidecar(buildSidecar(screen, { screenName: "Home", components: registry }));
  const parsed = parseSidecar(sidecar);
  assert.deepEqual(parsed.components, registry);

  // A malformed registry is rejected.
  const bad = JSON.parse(sidecar);
  bad.components.card1.name = "lowercase";
  assert.throws(() => parseSidecar(JSON.stringify(bad)), /Invalid .rncanvas.json sidecar/);
});

import { emitTheme } from "./index";
import type { TokenRegistry } from "@rn-canvas/document";

function tokenBoundScreen() {
  return createNode("View", {
    id: "screen",
    style: { padding: 16, backgroundColor: "#3b82f6" },
    design: { tokens: { backgroundColor: "tk1" } },
    children: [createNode("Text", { props: { text: "Hi" }, style: { color: "#111111" } })],
  });
}
const reg = (name: string): TokenRegistry => ({
  tk1: { id: "tk1", name, category: "color", value: "#3b82f6" },
});

test("a token-bound style emits theme.color.<name> + a theme import", () => {
  const gen = generateScreen(tokenBoundScreen(), { screenName: "Home", tokens: reg("brandPrimary") });
  assertParses(gen.code);
  assert.match(gen.code, /import \{ theme \} from "\.\/theme"/);
  assert.match(gen.code, /backgroundColor: theme\.color\.brandPrimary/);
  assert.match(gen.code, /color: "#111111"/); // unbound key stays literal
  assert.ok(gen.theme, "a theme module is emitted");
  assert.match(gen.theme!.code, /brandPrimary: "#3b82f6"/);
  assertParses(gen.theme!.code);
});

test("renaming a token changes only the emitted key, not the binding (identity contract)", () => {
  const root = tokenBoundScreen(); // binding is by id "tk1", never the name
  const before = generateScreen(root, { screenName: "Home", tokens: reg("brandPrimary") });
  const after = generateScreen(root, { screenName: "Home", tokens: reg("accent") });
  assert.match(before.code, /theme\.color\.brandPrimary/);
  assert.match(after.code, /theme\.color\.accent/);
  assert.ok(!after.code.includes("brandPrimary"));
  // The document binding is untouched across the rename.
  assert.deepEqual(root.design?.tokens, { backgroundColor: "tk1" });
});

test("a screen with no token bindings imports no theme", () => {
  const gen = generateScreen(createNode("View", { style: { padding: 8 } }), {
    screenName: "Home",
    tokens: reg("brandPrimary"),
  });
  assert.equal(gen.theme, undefined);
  assert.ok(!gen.code.includes("./theme"));
});

test("instance overrides linked to tokens emit theme refs", () => {
  const tokens: TokenRegistry = {
    tk1: { id: "tk1", name: "brand", category: "color", value: "#3b82f6" },
  };
  const definition = {
    id: "c1",
    name: "Btn",
    template: createNode("View", { id: "tpl" }),
    props: [
      {
        name: "tint",
        valueType: "color" as const,
        targets: [{ kind: "style" as const, nodeId: "tpl", styleKey: "backgroundColor" }],
      },
    ],
  };
  const instance: Node = {
    id: "i1",
    type: "ComponentInstance",
    componentId: "c1",
    overrides: { tint: "#3b82f6" },
    tokens: { tint: "tk1" },
    style: {},
  };
  const root = createNode("View", { children: [instance] });
  const gen = generateScreen(root, {
    screenName: "Home",
    tokens,
    components: { c1: definition },
  });
  assertParses(gen.code);
  // The instance JSX should reference the theme, not the hex literal.
  assert.match(gen.code, /tint=\{theme\.color\.brand\}/);
  assert.ok(!gen.code.includes('"#3b82f6"'), "no leaked hex literal");
});

test("dotted token names emit quoted keys + bracket-access references", () => {
  const tokens: TokenRegistry = {
    tk1: { id: "tk1", name: "color.primary.500", category: "color", value: "#3b82f6" },
  };
  const gen = generateScreen(tokenBoundScreen(), { screenName: "Home", tokens });
  assertParses(gen.code);
  assert.match(gen.code, /backgroundColor: theme\.color\["color\.primary\.500"\]/);
  assert.match(gen.theme!.code, /"color\.primary\.500": "#3b82f6"/);
  assertParses(gen.theme!.code);
});

test("emitTheme emits the registry as a typed theme module", () => {
  const theme = emitTheme({
    a: { id: "a", name: "bg", category: "color", value: "#fff" },
    b: { id: "b", name: "fg", category: "color", value: "#000" },
  });
  assert.equal(theme.fileName, "theme.ts");
  assert.match(theme.code, /export const theme = \{/);
  assert.match(theme.code, /bg: "#fff"/);
  assert.match(theme.code, /fg: "#000"/);
  assert.match(theme.code, /\} as const/);
  assertParses(theme.code);
});

test("the sidecar round-trips the token registry", () => {
  const tokens = reg("brandPrimary");
  const sidecar = serializeSidecar(buildSidecar(tokenBoundScreen(), { screenName: "Home", tokens }));
  assert.deepEqual(parseSidecar(sidecar).tokens, tokens);
  const bad = JSON.parse(sidecar);
  bad.tokens.tk1.value = 42;
  assert.throws(() => parseSidecar(JSON.stringify(bad)), /Invalid .rncanvas.json sidecar/);
});

test("spacing and fontSize tokens emit theme.<category>.<name>", () => {
  const tokens: TokenRegistry = {
    c1: { id: "c1", name: "brand", category: "color", value: "#3b82f6" },
    s1: { id: "s1", name: "lg", category: "spacing", value: 24 },
    f1: { id: "f1", name: "body", category: "fontSize", value: 16 },
  };
  const root = createNode("View", {
    id: "screen",
    style: { padding: 24, backgroundColor: "#3b82f6" },
    design: { tokens: { padding: "s1", backgroundColor: "c1" } },
    children: [
      createNode("Text", {
        id: "t",
        props: { text: "Hi" },
        style: { fontSize: 16, color: "#111111" },
        design: { tokens: { fontSize: "f1" } },
      }),
    ],
  });
  const gen = generateScreen(root, { screenName: "Home", tokens });
  assertParses(gen.code);
  assert.match(gen.code, /padding: theme\.spacing\.lg/);
  assert.match(gen.code, /backgroundColor: theme\.color\.brand/);
  assert.match(gen.code, /fontSize: theme\.fontSize\.body/);
  assert.match(gen.code, /color: "#111111"/); // unbound stays literal
  // theme module groups by category.
  assert.match(gen.theme!.code, /color: \{\s*brand:/);
  assert.match(gen.theme!.code, /spacing: \{\s*lg: 24/);
  assert.match(gen.theme!.code, /fontSize: \{\s*body: 16/);
  assertParses(gen.theme!.code);
});

// --- Phase 2D-2b: theme.ts as the canonical token source ---

import { openDocument, parseTheme, reconcileTokens } from "./index";

test("parseTheme round-trips emitTheme output across categories", () => {
  const tokens: TokenRegistry = {
    c1: { id: "c1", name: "brand", category: "color", value: "#3b82f6" },
    c2: { id: "c2", name: "color.primary.500", category: "color", value: "#abc" },
    s1: { id: "s1", name: "lg", category: "spacing", value: 24 },
    s2: { id: "s2", name: "tight", category: "spacing", value: -4 }, // negative literal
    f1: { id: "f1", name: "body", category: "fontSize", value: 16 },
  };
  const parsed = parseTheme(emitTheme(tokens).code);
  assert.equal(parsed.length, 5);
  // Membership checks (order-independent), keyed by category:name.
  const byKey = new Map(parsed.map((p) => [`${p.category}:${p.name}`, p.value]));
  assert.equal(byKey.get("color:brand"), "#3b82f6");
  assert.equal(byKey.get("color:color.primary.500"), "#abc");
  assert.equal(byKey.get("spacing:lg"), 24);
  assert.equal(byKey.get("spacing:tight"), -4);
  assert.equal(byKey.get("fontSize:body"), 16);
});

test("parseTheme returns [] for a theme-less module and fails closed on dynamic values", () => {
  assert.deepEqual(parseTheme(`export const other = 1;`), []);
  assert.throws(
    () => parseTheme(`export const theme = { color: { brand: someVar } } as const;`),
    /Unsupported theme.ts source/,
  );
  assert.throws(
    () => parseTheme(`export const theme = { shadow: { x: 1 } } as const;`),
    /unknown category/,
  );
});

test("reconcileTokens keeps ids on match, mints on add, drops on remove", () => {
  const prior: TokenRegistry = {
    tk1: { id: "tk1", name: "brand", category: "color", value: "#000" },
    tk2: { id: "tk2", name: "lg", category: "spacing", value: 24 },
  };
  // File: brand changed value, lg removed, a new fontSize token added.
  const next = reconcileTokens(
    [
      { category: "color", name: "brand", value: "#3b82f6" },
      { category: "fontSize", name: "body", value: 16 },
    ],
    prior,
  );
  const entries = Object.values(next);
  const brand = entries.find((t) => t.name === "brand")!;
  assert.equal(brand.id, "tk1", "id reused on category:name match");
  assert.equal(brand.value, "#3b82f6", "value comes from the file");
  assert.ok(!entries.some((t) => t.name === "lg"), "removed-in-file token is dropped");
  const body = entries.find((t) => t.name === "body")!;
  assert.match(body.id, /[0-9a-f-]{8,}/, "added-in-file token gets a fresh id");
});

function boundSidecar(value: string) {
  const tokens: TokenRegistry = {
    tk1: { id: "tk1", name: "brand", category: "color", value },
  };
  const root = createNode("View", {
    id: "screen",
    style: { backgroundColor: value },
    design: { tokens: { backgroundColor: "tk1" } },
  });
  return serializeSidecar(buildSidecar(root, { screenName: "Home", tokens }));
}

test("openDocument: file value overrides the sidecar literal and reapplies to bound nodes", () => {
  const sidecar = boundSidecar("#000000"); // sidecar literal is black
  const themeSource = emitTheme({
    tk1: { id: "ignored", name: "brand", category: "color", value: "#3b82f6" },
  }).code; // file says blue
  const opened = openDocument(sidecar, themeSource);
  // File wins for the value; the id stays stable (reconciled by category:name).
  assert.equal(opened.tokens.tk1.value, "#3b82f6");
  assert.equal(opened.tokens.tk1.id, "tk1");
  assert.equal((opened.root.style as { backgroundColor?: string }).backgroundColor, "#3b82f6");
  // Binding preserved.
  assert.deepEqual(opened.root.design?.tokens, { backgroundColor: "tk1" });
});

test("openDocument: a hand-renamed token in the file drops its dangling binding", () => {
  const sidecar = boundSidecar("#000000");
  // The file renames brand → accent (a remove+add to a name-keyed file).
  const themeSource = emitTheme({
    x: { id: "x", name: "accent", category: "color", value: "#3b82f6" },
  }).code;
  const opened = openDocument(sidecar, themeSource);
  assert.equal(Object.keys(opened.tokens).length, 1);
  assert.ok(!opened.root.design?.tokens, "binding to the removed token is cleaned up");
  // Literal is retained from the last resolved value.
  assert.equal((opened.root.style as { backgroundColor?: string }).backgroundColor, "#000000");
});

test("openDocument: missing theme falls back to the sidecar tokens", () => {
  const sidecar = boundSidecar("#123456");
  const opened = openDocument(sidecar); // no theme source
  assert.equal(opened.tokens.tk1.value, "#123456");
  assert.deepEqual(opened.root.design?.tokens, { backgroundColor: "tk1" });
});

// --- Phase 2D-3: variant component-sets ---

function buttonSet(): ComponentDefinition {
  return {
    id: "btn",
    name: "Button",
    template: createNode("Pressable", {
      id: "root",
      style: { backgroundColor: "#2222ff", padding: 8 },
      children: [
        createNode("Text", { id: "label", props: { text: "Go" }, style: { color: "#ffffff", fontSize: 14 } }),
        createNode("View", { id: "icon", style: { width: 8, height: 8 } }),
      ],
    }),
    props: [],
    variants: [
      { name: "size", values: ["sm", "lg"] },
      { name: "state", values: ["default", "disabled"] },
    ],
    combinations: [
      { values: { size: "lg", state: "default" }, overrides: [{ nodeId: "root", style: { padding: 16 } }] },
      { values: { size: "sm", state: "disabled" }, overrides: [{ nodeId: "root", style: { opacity: 0.5 } }, { nodeId: "icon", hidden: true }] },
      { values: { size: "lg", state: "disabled" }, overrides: [{ nodeId: "root", style: { padding: 16, opacity: 0.5 } }] },
    ],
  };
}

function screenWith(...instances: Node[]): Node {
  return createNode("View", { id: "screen", children: instances });
}

test("a variant component emits typed unions, per-axis style lookups, and usages", () => {
  const screen = screenWith(
    { id: "b1", type: "ComponentInstance", componentId: "btn", overrides: {}, style: {}, variant: { size: "lg", state: "disabled" } },
    { id: "b2", type: "ComponentInstance", componentId: "btn", overrides: {}, style: {} },
  );
  const gen = generateScreen(screen, { screenName: "Home", components: { btn: buttonSet() } });
  const mod = gen.components.find((c) => c.name === "Button")!.code;

  // Typed axis props + defaults.
  assert.match(mod, /size\?: "sm" \| "lg"/);
  assert.match(mod, /state\?: "default" \| "disabled"/);
  assert.match(mod, /size = "sm"/);
  assert.match(mod, /state = "default"/);
  // root's overrides factor per axis → per-axis computed-key lookups.
  assert.match(mod, /styles\[`pressable_size_\$\{size\}`\]/);
  assert.match(mod, /styles\[`pressable_state_\$\{state\}`\]/);
  assert.match(mod, /pressable_size_lg: \{\s*padding: 16/);
  // hidden icon → render guard from the variant props.
  assert.match(mod, /!\(size === "sm" && state === "disabled"\) && <View/);
  assertParses(mod);

  // Usages: non-default values as attrs; all-default instance omits them.
  assert.match(gen.code, /<Button size="lg" state="disabled" \/>/);
  assert.match(gen.code, /<Button \/>/);
});

test("a node with a non-factoring (cross-axis) override falls back to a combination key", () => {
  const def = buttonSet();
  // Make the label diverge: only the (lg, default) cell sets fontSize → cannot be
  // expressed as a per-axis contribution, so it must be combination-keyed.
  def.combinations = [
    { values: { size: "lg", state: "default" }, overrides: [{ nodeId: "label", style: { fontSize: 18 } }] },
  ];
  const screen = screenWith({ id: "b1", type: "ComponentInstance", componentId: "btn", overrides: {}, style: {} });
  const mod = generateScreen(screen, { screenName: "Home", components: { btn: def } }).components[0].code;
  assert.match(mod, /styles\[`text_v_\$\{size\}_\$\{state\}`\]/);
  assert.match(mod, /text_v_lg_default: \{\s*fontSize: 18/);
  assertParses(mod);
});

test("the sidecar round-trips variant axes, combinations, and instance selection", () => {
  const screen = screenWith({ id: "b1", type: "ComponentInstance", componentId: "btn", overrides: {}, style: {}, variant: { size: "lg" } });
  const def = buttonSet();
  const sidecar = generateScreen(screen, { screenName: "Home", components: { btn: def } }).sidecar;
  const parsed = parseSidecar(sidecar);
  assert.deepEqual(parsed.components!.btn.variants, def.variants);
  assert.deepEqual(parsed.components!.btn.combinations, def.combinations);
  const inst = (parsed.root as { children: { id: string; variant?: unknown }[] }).children[0];
  assert.deepEqual(inst.variant, { size: "lg" });
});
