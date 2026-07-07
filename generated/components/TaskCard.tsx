import { StyleSheet, View } from "react-native";
interface TaskCardProps {}
export function TaskCard({}: TaskCardProps) {
  return <View style={styles.view} />;
}
const styles = StyleSheet.create({
  view: {
    width: 287,
    height: 147,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderRadius: 16,
    borderColor: "#E2E8F0"
  }
});
