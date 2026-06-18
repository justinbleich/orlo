import { useEffect, useState } from "react";
import {
  Image,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native-web";
import type { FixtureNode } from "@rn-canvas/fixture";
import {
  computeLayout,
  pickVisualStyle,
  type LayoutBox,
} from "./yoga-layout";

type RNFrameRendererProps = {
  root: FixtureNode;
  onLayoutReady?: (layout: LayoutBox, width: number, height: number) => void;
};

function flattenLayout(box: LayoutBox, result: LayoutBox[] = []): LayoutBox[] {
  result.push(box);
  for (const child of box.children) {
    flattenLayout(child, result);
  }
  return result;
}

function renderLayoutBox(box: LayoutBox): React.ReactNode {
  const { node, left, top, width, height } = box;
  const visualStyle = pickVisualStyle(node.style ?? {});
  const positionStyle = {
    position: "absolute" as const,
    left,
    top,
    width,
    height,
    ...visualStyle,
  };

  if (node.type === "Text") {
    return (
      <Text key={`${left}-${top}-text`} style={positionStyle}>
        {String(node.props?.children ?? "")}
      </Text>
    );
  }

  if (node.type === "Image") {
    return (
      <Image
        key={`${left}-${top}-image`}
        source={node.props?.source as ImageSourcePropType}
        style={positionStyle}
        resizeMode="contain"
      />
    );
  }

  return (
    <View key={`${left}-${top}-view`} style={positionStyle} />
  );
}

export function RNFrameRenderer({ root, onLayoutReady }: RNFrameRendererProps) {
  const [layoutState, setLayoutState] = useState<{
    layout: LayoutBox;
    width: number;
    height: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    computeLayout(root)
      .then(({ layout, rootWidth, rootHeight }) => {
        if (cancelled) return;
        setLayoutState({ layout, width: rootWidth, height: rootHeight });
        onLayoutReady?.(layout, rootWidth, rootHeight);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Layout failed");
      });

    return () => {
      cancelled = true;
    };
  }, [root, onLayoutReady]);

  if (error) {
    return (
      <View style={{ padding: 16, backgroundColor: "#fee" }}>
        <Text style={{ color: "#900" }}>Yoga layout error: {error}</Text>
      </View>
    );
  }

  if (!layoutState) {
    return (
      <View style={{ width: 320, height: 120, backgroundColor: "#f5f5f5" }}>
        <Text style={{ padding: 16, color: "#666" }}>Computing Yoga layout…</Text>
      </View>
    );
  }

  const { layout, width, height } = layoutState;
  const flat = flattenLayout(layout);

  return (
    <View
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
      }}
    >
      {flat.map((box) => renderLayoutBox(box))}
    </View>
  );
}

export { computeLayout, computePixelDiff, pickVisualStyle } from "./yoga-layout";
export type { LayoutBox } from "./yoga-layout";
