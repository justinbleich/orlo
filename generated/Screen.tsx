import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "./theme";
export default function Screen() {
  return <View style={styles.view}><Image style={styles.image} source={{
      uri: ""
    }} resizeMode={"cover"} /><Pressable style={styles.pressable}><Text style={styles.text}>Next</Text></Pressable></View>;
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
    gap: 14
  },
  image: {
    height: 144,
    alignSelf: "stretch",
    borderRadius: theme.spacing.space1,
    backgroundColor: theme.color.canvas
  },
  pressable: {
    padding: theme.spacing.space1,
    backgroundColor: "#3a3a45",
    borderRadius: theme.spacing["full.radius"],
    position: "absolute",
    left: 16,
    bottom: 40,
    height: 64,
    right: 16,
    justifyContent: "center",
    alignItems: "center"
  },
  text: {
    fontFamily: "Inter",
    fontSize: theme.fontSize.text2,
    color: theme.color.color1,
    textAlign: "center",
    fontWeight: "600"
  }
});
