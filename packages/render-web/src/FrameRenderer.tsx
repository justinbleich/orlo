import { memo, useEffect, useRef, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ImageSourcePropType,
} from "react-native-web";
import type { ComponentRegistry, Node } from "@rn-canvas/document";
import { expandComponents } from "@rn-canvas/document";
import { pickVisualStyle } from "@rn-canvas/styles";
import {
  computeLayout,
  createLayoutSnapshot,
  type LayoutBox,
  type LayoutSnapshot,
} from "./yoga-layout";

export type RenderInstrumentation = {
  onLayout?: (metrics: { durationMs: number; boxes: number }) => void;
  onNodePaint?: (metrics: { instanceKey: string; nodeId: string }) => void;
};

export type LayoutReadyResult = {
  layout: LayoutBox;
  snapshot: LayoutSnapshot;
  width: number;
  height: number;
};

type FrameRendererProps = {
  root: Node;
  /** Component definitions used to expand any ComponentInstance nodes (Phase 2C). */
  components?: ComponentRegistry;
  onLayoutReady?: (result: LayoutReadyResult) => void;
  instrumentation?: RenderInstrumentation;
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
  const { instanceKey, node, left, top, width, height } = box;
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
        <Text key={instanceKey} style={positionStyle} numberOfLines={node.props.numberOfLines}>
          {node.props.text}
        </Text>
      );
    case "Image": {
      const source =
        "uri" in node.props.source ? { uri: node.props.source.uri } : undefined;
      return (
        <Image
          key={instanceKey}
          source={source as ImageSourcePropType}
          style={positionStyle}
          resizeMode={node.props.resizeMode ?? "cover"}
        />
      );
    }
    case "TextInput":
      return (
        <TextInput
          key={instanceKey}
          style={positionStyle}
          placeholder={node.props.placeholder}
          value={node.props.value}
          editable={node.props.editable}
          secureTextEntry={node.props.secureTextEntry}
          keyboardType={node.props.keyboardType}
        />
      );
    case "Pressable":
      return (
        <Pressable key={instanceKey} style={positionStyle} disabled={node.props.disabled} />
      );
    case "ScrollView":
      return (
        <ScrollView
          key={instanceKey}
          style={positionStyle}
          horizontal={node.props.horizontal}
          showsHorizontalScrollIndicator={
            node.props.horizontal ? node.props.showsScrollIndicator : undefined
          }
          showsVerticalScrollIndicator={
            node.props.horizontal ? undefined : node.props.showsScrollIndicator
          }
        />
      );
    case "FlatList":
      // Children are drawn as their own absolute boxes; the container itself is
      // just a positioned surface in the canvas preview.
      return (
        <ScrollView
          key={instanceKey}
          style={positionStyle}
          horizontal={node.props.horizontal}
        />
      );
    default:
      return <View key={instanceKey} style={positionStyle} />;
  }
}

function sameLayoutBox(a: LayoutBox, b: LayoutBox): boolean {
  return (
    a.instanceKey === b.instanceKey &&
    a.node === b.node &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}

const RenderedLayoutBox = memo(
  function RenderedLayoutBox({
    box,
    onNodePaint,
  }: {
    box: LayoutBox;
    onNodePaint?: RenderInstrumentation["onNodePaint"];
  }) {
    useEffect(() => {
      onNodePaint?.({ instanceKey: box.instanceKey, nodeId: box.node.id });
    });
    return renderLayoutBox(box);
  },
  (previous, next) =>
    previous.onNodePaint === next.onNodePaint && sameLayoutBox(previous.box, next.box),
);

export function FrameRenderer({
  root,
  components,
  onLayoutReady,
  instrumentation,
}: FrameRendererProps) {
  const onLayoutReadyRef = useRef(onLayoutReady);
  const instrumentationRef = useRef(instrumentation);
  onLayoutReadyRef.current = onLayoutReady;
  instrumentationRef.current = instrumentation;
  const [layoutState, setLayoutState] = useState<{
    layout: LayoutBox;
    snapshot: LayoutSnapshot;
    width: number;
    height: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const started = globalThis.performance?.now() ?? Date.now();

    // Resolve component instances into a primitive tree before Yoga sees it.
    const expanded = components ? expandComponents(root, components) : root;

    computeLayout(expanded)
      .then(({ layout, rootWidth, rootHeight }) => {
        if (cancelled) return;
        const snapshot = createLayoutSnapshot(layout);
        const result = { layout, snapshot, width: rootWidth, height: rootHeight };
        setLayoutState(result);
        onLayoutReadyRef.current?.(result);
        instrumentationRef.current?.onLayout?.({
          durationMs: (globalThis.performance?.now() ?? Date.now()) - started,
          boxes: flattenLayout(layout).length,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Layout failed");
      });

    return () => {
      cancelled = true;
    };
  }, [root, components]);

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
      {flat.map((box) => (
        <RenderedLayoutBox
          key={box.instanceKey}
          box={box}
          onNodePaint={instrumentation?.onNodePaint}
        />
      ))}
    </View>
  );
}

export { computeLayout, computePixelDiff } from "./yoga-layout";
export type { LayoutBox, LayoutSnapshot } from "./yoga-layout";
