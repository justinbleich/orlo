import { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ImageSourcePropType,
} from "react-native-web";
import type { Node } from "@rn-canvas/document";
import { pickVisualStyle } from "@rn-canvas/styles";
import { computeLayout, type LayoutBox } from "./yoga-layout";

type RNFrameRendererProps = {
  root: Node;
  onLayoutReady?: (layout: LayoutBox, width: number, height: number) => void;
};

/**
 * Flatten the Yoga layout into a draw list. Yoga is authoritative for geometry,
 * so every node is painted absolutely positioned. design.hidden nodes (and their
 * subtrees) are skipped — the same flag the canvas interaction layer honors.
 */
function flattenLayout(box: LayoutBox, result: LayoutBox[] = []): LayoutBox[] {
  if (box.node.design?.hidden) return result;
  result.push(box);
  for (const child of box.children) {
    flattenLayout(child, result);
  }
  return result;
}

function renderLayoutBox(box: LayoutBox): React.ReactNode {
  const { node, left, top, width, height } = box;
  const positionStyle = {
    position: "absolute" as const,
    left,
    top,
    width,
    height,
    ...pickVisualStyle(node.style),
  };

  switch (node.type) {
    case "Text":
      return (
        <Text key={node.id} style={positionStyle} numberOfLines={node.props.numberOfLines}>
          {node.props.text}
        </Text>
      );
    case "Image": {
      const source =
        "uri" in node.props.source ? { uri: node.props.source.uri } : undefined;
      return (
        <Image
          key={node.id}
          source={source as ImageSourcePropType}
          style={positionStyle}
          resizeMode={node.props.resizeMode ?? "cover"}
        />
      );
    }
    case "TextInput":
      return (
        <TextInput
          key={node.id}
          style={positionStyle}
          placeholder={node.props.placeholder}
          defaultValue={node.props.value}
          editable={node.props.editable}
          secureTextEntry={node.props.secureTextEntry}
        />
      );
    case "Pressable":
      return <Pressable key={node.id} style={positionStyle} />;
    case "ScrollView":
    case "FlatList":
      // Children are drawn as their own absolute boxes; the container itself is
      // just a positioned surface in the canvas preview.
      return <ScrollView key={node.id} style={positionStyle} />;
    default:
      return <View key={node.id} style={positionStyle} />;
  }
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
    <View style={{ position: "relative", width, height, overflow: "hidden" }}>
      {flat.map((box) => renderLayoutBox(box))}
    </View>
  );
}

export { computeLayout, computePixelDiff } from "./yoga-layout";
export type { LayoutBox } from "./yoga-layout";
