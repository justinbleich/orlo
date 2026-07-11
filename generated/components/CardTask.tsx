import { StyleSheet, Text, View } from "react-native";
interface CardTaskProps {
  title?: string;
  subtitle?: string;
  background?: string;
}
export function CardTask({
  title = "Buy groceries",
  subtitle = "Due tomorrow \xB7 9:00",
  background = "#FFFFFF"
}: CardTaskProps) {
  return <View style={[styles.view, {
    backgroundColor: background
  }]}><Text style={styles.text}>{title}</Text><Text style={styles.text2}>{subtitle}</Text></View>;
}
const styles = StyleSheet.create({
  view: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: "#E5E7EB"
  },
  text: {
    fontFamily: "Inter",
    fontSize: 16,
    color: "#111827",
    fontWeight: "600"
  },
  text2: {
    fontFamily: "Inter",
    fontSize: 13,
    color: "#6B7280"
  }
});
