import type { Node } from "@rn-canvas/document";
import { childrenOf } from "@rn-canvas/document";
import {
  applyLayoutStyle,
  createCanvasTextMeasurer,
  type TextMeasurer,
} from "@rn-canvas/styles";
import type { Node as YogaNode, Yoga } from "yoga-layout/load";
import { Direction, MeasureMode } from "yoga-layout";

export type LayoutBox = {
  node: Node;
  left: number;
  top: number;
  width: number;
  height: number;
  children: LayoutBox[];
};

type YogaTree = {
  yogaNode: YogaNode;
  node: Node;
  children: YogaTree[];
};

function buildYogaTree(
  Yoga: Yoga,
  node: Node,
  measurer: TextMeasurer,
): YogaTree {
  const yogaNode = Yoga.Node.create();

  // The single authority maps style → Yoga; the renderer never maps layout itself.
  applyLayoutStyle(yogaNode, node.style);

  if (node.type === "Text") {
    const { text, numberOfLines } = node.props;
    yogaNode.setMeasureFunc((width, widthMode) => {
      const maxWidth = widthMode === MeasureMode.Undefined ? undefined : width;
      return measurer.measure({ text, style: node.style, numberOfLines, maxWidth });
    });
  }

  const children = childrenOf(node).map((child) =>
    buildYogaTree(Yoga, child, measurer),
  );
  children.forEach((child, i) => yogaNode.insertChild(child.yogaNode, i));

  return { yogaNode, node, children };
}

function collectLayout(tree: YogaTree, offsetLeft = 0, offsetTop = 0): LayoutBox {
  const { yogaNode, node, children } = tree;
  const left = offsetLeft + yogaNode.getComputedLeft();
  const top = offsetTop + yogaNode.getComputedTop();
  const width = yogaNode.getComputedWidth();
  const height = yogaNode.getComputedHeight();

  return {
    node,
    left,
    top,
    width,
    height,
    children: children.map((child) => collectLayout(child, left, top)),
  };
}

let yogaPromise: Promise<Yoga> | null = null;

export async function loadYogaModule(): Promise<Yoga> {
  if (!yogaPromise) {
    yogaPromise = import("yoga-layout/load").then((mod) => mod.loadYoga());
  }
  return yogaPromise;
}

const defaultMeasurer = createCanvasTextMeasurer();

export async function computeLayout(
  root: Node,
  opts: { measurer?: TextMeasurer } = {},
): Promise<{ layout: LayoutBox; rootWidth: number; rootHeight: number }> {
  const Yoga = await loadYogaModule();
  const tree = buildYogaTree(Yoga, root, opts.measurer ?? defaultMeasurer);

  tree.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);

  const layout = collectLayout(tree);
  const rootWidth = tree.yogaNode.getComputedWidth();
  const rootHeight = tree.yogaNode.getComputedHeight();

  tree.yogaNode.freeRecursive();

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
