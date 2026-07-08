import { StyleSheet, Text, View } from "react-native";
import { ButtonPrimary } from "./components/ButtonPrimary";
import { ButtonQuaternary } from "./components/ButtonQuaternary";
import { TaskCard } from "./components/TaskCard";
export default function Screen1() {
  return <View style={styles.view}><Text style={styles.text}>Focus Planner</Text><Text style={styles.text2}>Today</Text><TaskCard /><ButtonPrimary /><Text style={styles.text3}>Text</Text><View style={styles.view2}><Text style={styles.text4}>2 tasks dueText2 tasks due</Text></View><TaskCard /><ButtonPrimary /><TaskCard /><ButtonQuaternary /></View>;
}
const styles = StyleSheet.create({
  view: {
    width: 390,
    height: 844,
    backgroundColor: "#ffffff",
    flexDirection: "column",
    padding: 16,
    paddingTop: 64,
    paddingBottom: 48,
    gap: 12
  },
  text: {
    fontFamily: "Inter",
    fontSize: 14,
    color: "#111111"
  },
  text2: {
    fontFamily: "Inter",
    fontSize: 14,
    color: "#111111"
  },
  text3: {
    fontFamily: "Inter",
    fontSize: 14,
    color: "#111111"
  },
  view2: {
    width: 166,
    height: 90,
    backgroundColor: "#F8FAFC",
    opacity: 1,
    borderRadius: 18
  },
  text4: {
    fontFamily: "Inter",
    fontSize: 14,
    color: "#111111"
  }
});
