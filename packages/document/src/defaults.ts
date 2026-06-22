/** Default props + styles for freshly created nodes (createNode). */
import type { RNStyle } from "@rn-canvas/styles";
import type { PropsByType, RNPrimitive } from "./types";

export const DEFAULT_PROPS: { [K in RNPrimitive]: PropsByType[K] } = {
  View: {},
  Text: { text: "Text" },
  Image: { source: { uri: "" }, resizeMode: "cover" },
  Pressable: {},
  ScrollView: {},
  TextInput: { placeholder: "", editable: true },
  FlatList: { data: [] },
};

export const DEFAULT_STYLE: { [K in RNPrimitive]: RNStyle } = {
  View: {},
  Text: { fontFamily: "Inter", fontSize: 14, color: "#111111" },
  Image: { width: 64, height: 64 },
  Pressable: {},
  ScrollView: { flex: 1 },
  TextInput: {
    borderWidth: 1,
    borderColor: "#cccccc",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontFamily: "Inter",
    fontSize: 14,
  },
  FlatList: { flex: 1 },
};
