import { phase0Fixture, type FixtureNode } from "@rn-canvas/fixture";
import { StatusBar } from "expo-status-bar";
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import type { ReactNode } from "react";

/**
 * Native ground-truth render of the *shared* Phase 0 fixture.
 * Walks the same tree the canvas renders so the two can never drift —
 * RN's native Yoga does the layout here; rnw + WASM Yoga does it on the canvas.
 */
function renderNode(node: FixtureNode, key?: number): ReactNode {
  const style = node.style as object | undefined;

  if (node.type === "Text") {
    return (
      <Text key={key} style={style}>
        {String(node.props?.children ?? "")}
      </Text>
    );
  }

  if (node.type === "Image") {
    return (
      <Image
        key={key}
        source={node.props?.source as ImageSourcePropType}
        style={style}
        resizeMode="contain"
      />
    );
  }

  return (
    <View key={key} style={style}>
      {(node.children ?? []).map((child, i) => renderNode(child, i))}
    </View>
  );
}

export default function App() {
  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      {renderNode(phase0Fixture)}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f0f0f0",
    alignItems: "center",
    justifyContent: "center",
  },
});
