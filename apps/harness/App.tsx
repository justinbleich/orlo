import type { Node } from "@rn-canvas/document";
import { sampleDocument } from "@rn-canvas/document/sample";
import { StatusBar } from "expo-status-bar";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageSourcePropType,
} from "react-native";
import type { ReactNode } from "react";

/**
 * Native ground-truth render of the *shared* document tree. Walks the same
 * canonical tree the canvas renders, so the two can never drift — RN's native
 * Yoga lays out here; rnw + WASM Yoga does it on the canvas.
 *
 * Imports the sample via the `./sample` subpath so the RN bundle never pulls in
 * the WASM Yoga mapping or the Zustand store.
 */
function renderNode(node: Node, key?: number): ReactNode {
  if (node.design?.hidden) return null;
  const style = node.style as object;

  switch (node.type) {
    case "Text":
      return (
        <Text key={key} style={style} numberOfLines={node.props.numberOfLines}>
          {node.props.text}
        </Text>
      );
    case "Image": {
      const source =
        "uri" in node.props.source ? { uri: node.props.source.uri } : undefined;
      return (
        <Image
          key={key}
          source={source as ImageSourcePropType}
          style={style}
          resizeMode={node.props.resizeMode ?? "cover"}
        />
      );
    }
    case "TextInput":
      return (
        <TextInput
          key={key}
          style={style}
          placeholder={node.props.placeholder}
          defaultValue={node.props.value}
          editable={node.props.editable}
          secureTextEntry={node.props.secureTextEntry}
        />
      );
    case "ScrollView":
      return (
        <ScrollView key={key} style={style} horizontal={node.props.horizontal}>
          {node.children.map((child, i) => renderNode(child, i))}
        </ScrollView>
      );
    case "Pressable":
      return (
        <Pressable key={key} style={style}>
          {node.children.map((child, i) => renderNode(child, i))}
        </Pressable>
      );
    case "FlatList": {
      // v1 harness: render the single item template once per data row.
      const template = node.children[0];
      return (
        <View key={key} style={style}>
          {template ? node.props.data.map((_, i) => renderNode(template, i)) : null}
        </View>
      );
    }
    default:
      return (
        <View key={key} style={style}>
          {node.children.map((child, i) => renderNode(child, i))}
        </View>
      );
  }
}

export default function App() {
  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      {renderNode(sampleDocument)}
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
