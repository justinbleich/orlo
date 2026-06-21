import { Image, StyleSheet, Text, View } from "react-native";
export default function Screen() {
  return <View style={styles.view}><Text style={styles.text}>Hello RN Canvas</Text><Image style={styles.image} source={{
      uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAp0lEQVR4AdXBQQqDUBAFwZ7Gi+bauUoWE0EhigquzH9V9Xp/uKl5VnHDxLXmv5q94sTEUTOmZlFsyF4zvmZDfpoczUrCyaLJ08wknISTcAJNrpZwEk7CSTgJJ+EknISTcBJOwkk4CSfhJJyEk3ASTsJJOAkn4SSchJNwEk7CCRS5SsJJOAkniyJPMZNw8lPkKFayV4yv2Jg4KhbNWIoTE9eKveZZxQ1f+qIRngMFE4cAAAAASUVORK5CYII="
    }} resizeMode="contain" /></View>;
}
const styles = StyleSheet.create({
  view: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    width: 320,
    height: 120,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0"
  },
  text: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111111"
  },
  image: {
    width: 48,
    height: 48
  }
});
