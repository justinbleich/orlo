import type { FixtureNode } from "@rn-canvas/fixture";
import type { Node, Yoga } from "yoga-layout/load";
import { Align, Direction, Edge, FlexDirection, Justify } from "yoga-layout";

export type LayoutBox = {
  node: FixtureNode;
  left: number;
  top: number;
  width: number;
  height: number;
  children: LayoutBox[];
};

const VISUAL_STYLE_KEYS = new Set([
  "backgroundColor",
  "borderRadius",
  "borderWidth",
  "borderColor",
  "color",
  "fontSize",
  "fontWeight",
  "opacity",
]);

export function pickVisualStyle(
  style: Record<string, unknown> = {},
): Record<string, unknown> {
  const visual: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    if (VISUAL_STYLE_KEYS.has(key)) {
      visual[key] = value;
    }
  }
  return visual;
}

function applyStyleToYogaNode(
  yogaNode: Node,
  style: Record<string, unknown> = {},
): void {
  const flexDirection = style.flexDirection as string | undefined;
  if (flexDirection === "row") {
    yogaNode.setFlexDirection(FlexDirection.Row);
  } else if (flexDirection === "column") {
    yogaNode.setFlexDirection(FlexDirection.Column);
  }

  const alignItems = style.alignItems as string | undefined;
  if (alignItems === "center") {
    yogaNode.setAlignItems(Align.Center);
  } else if (alignItems === "flex-start") {
    yogaNode.setAlignItems(Align.FlexStart);
  } else if (alignItems === "flex-end") {
    yogaNode.setAlignItems(Align.FlexEnd);
  }

  const justifyContent = style.justifyContent as string | undefined;
  if (justifyContent === "space-between") {
    yogaNode.setJustifyContent(Justify.SpaceBetween);
  } else if (justifyContent === "center") {
    yogaNode.setJustifyContent(Justify.Center);
  } else if (justifyContent === "flex-start") {
    yogaNode.setJustifyContent(Justify.FlexStart);
  }

  if (typeof style.padding === "number") {
    yogaNode.setPadding(Edge.All, style.padding);
  }

  if (typeof style.width === "number") {
    yogaNode.setWidth(style.width);
  }
  if (typeof style.height === "number") {
    yogaNode.setHeight(style.height);
  }

  if (typeof style.flex === "number") {
    yogaNode.setFlex(style.flex);
  }
  if (typeof style.flexGrow === "number") {
    yogaNode.setFlexGrow(style.flexGrow);
  }
  if (typeof style.flexShrink === "number") {
    yogaNode.setFlexShrink(style.flexShrink);
  }
}

function estimateTextSize(
  text: string,
  style: Record<string, unknown>,
): { width: number; height: number } {
  const fontSize = typeof style.fontSize === "number" ? style.fontSize : 16;
  const fontWeight = style.fontWeight === "600" ? "600" : "400";
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.font = `${fontWeight} ${fontSize}px system-ui, -apple-system, sans-serif`;
      const metrics = ctx.measureText(text);
      return {
        width: Math.ceil(metrics.width),
        height: Math.ceil(fontSize * 1.25),
      };
    }
  }
  return { width: text.length * (fontSize * 0.6), height: fontSize * 1.25 };
}

type YogaTree = {
  yogaNode: Node;
  fixtureNode: FixtureNode;
  children: YogaTree[];
};

function buildYogaTree(Yoga: Yoga, fixtureNode: FixtureNode): YogaTree {
  const yogaNode = Yoga.Node.create();

  applyStyleToYogaNode(yogaNode, fixtureNode.style ?? {});

  if (fixtureNode.type === "Text") {
    const text = String(fixtureNode.props?.children ?? "");
    const size = estimateTextSize(text, fixtureNode.style ?? {});
    yogaNode.setMeasureFunc((_width, _widthMode, _height, _heightMode) => ({
      width: size.width,
      height: size.height,
    }));
  } else if (fixtureNode.type === "Image") {
    const style = fixtureNode.style ?? {};
    if (typeof style.width === "number") {
      yogaNode.setWidth(style.width);
    }
    if (typeof style.height === "number") {
      yogaNode.setHeight(style.height);
    }
  }

  const children = (fixtureNode.children ?? []).map((child) =>
    buildYogaTree(Yoga, child),
  );

  for (const child of children) {
    yogaNode.insertChild(child.yogaNode, yogaNode.getChildCount());
  }

  return { yogaNode, fixtureNode, children };
}

function collectLayout(
  yogaTree: YogaTree,
  offsetLeft = 0,
  offsetTop = 0,
): LayoutBox {
  const { yogaNode, fixtureNode, children } = yogaTree;
  const left = offsetLeft + yogaNode.getComputedLeft();
  const top = offsetTop + yogaNode.getComputedTop();
  const width = yogaNode.getComputedWidth();
  const height = yogaNode.getComputedHeight();

  return {
    node: fixtureNode,
    left,
    top,
    width,
    height,
    children: children.map((child) => collectLayout(child, left, top)),
  };
}

function freeYogaTree(tree: YogaTree): void {
  tree.yogaNode.freeRecursive();
}

let yogaPromise: Promise<Yoga> | null = null;

export async function loadYogaModule(): Promise<Yoga> {
  if (!yogaPromise) {
    yogaPromise = import("yoga-layout/load").then((mod) => mod.loadYoga());
  }
  return yogaPromise;
}

export async function computeLayout(
  root: FixtureNode,
): Promise<{ layout: LayoutBox; rootWidth: number; rootHeight: number }> {
  const Yoga = await loadYogaModule();
  const tree = buildYogaTree(Yoga, root);

  tree.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);

  const layout = collectLayout(tree);
  const rootWidth = tree.yogaNode.getComputedWidth();
  const rootHeight = tree.yogaNode.getComputedHeight();

  freeYogaTree(tree);

  return { layout, rootWidth, rootHeight };
}

export function computePixelDiff(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
): { diffPixels: number; totalPixels: number; score: number } {
  const totalPixels = width * height;
  let diffPixels = 0;
  const len = Math.min(a.length, b.length);

  for (let i = 0; i < len; i += 4) {
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i + 1] - b[i + 1]);
    const db = Math.abs(a[i + 2] - b[i + 2]);
    const da = Math.abs(a[i + 3] - b[i + 3]);
    if (dr + dg + db + da > 40) {
      diffPixels += 1;
    }
  }

  return {
    diffPixels,
    totalPixels,
    score: 1 - diffPixels / totalPixels,
  };
}
