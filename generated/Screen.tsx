import { Image, StyleSheet, View } from "react-native";
import { AddTask } from "./components/AddTask";
import { ButtonPrimary2 } from "./components/ButtonPrimary2";
import { ButtonSecondary } from "./components/ButtonSecondary";
import { CardTask } from "./components/CardTask";
import { PressableComponent } from "./components/PressableComponent";
import { TextComponent } from "./components/TextComponent";
import { theme } from "./theme";
export default function Screen() {
  return <View style={styles.view}><Image style={styles.image} source={{
      uri: ""
    }} resizeMode={"cover"} /><ButtonPrimary2 /><TextComponent /><CardTask /><AddTask /><ButtonSecondary /><PressableComponent /></View>;
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
  }
});
