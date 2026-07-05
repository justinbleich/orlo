import { StyleSheet, Text, View } from "react-native";
export default function AccountSettings() {
  return <View style={styles.view}><Text style={styles.text}>Account Settings</Text><Text style={styles.text2}>Confirm profile, notifications, and billing preferences.</Text></View>;
}
const styles = StyleSheet.create({
  view: {
    width: 390,
    height: 844,
    backgroundColor: "#F7F8FB",
    flexDirection: "column",
    padding: 28,
    paddingTop: 72,
    gap: 16
  },
  text: {
    fontFamily: "Inter",
    fontSize: 28,
    fontWeight: "700",
    color: "#111827"
  },
  text2: {
    fontFamily: "Inter",
    fontSize: 16,
    lineHeight: 22,
    color: "#667085"
  }
});
