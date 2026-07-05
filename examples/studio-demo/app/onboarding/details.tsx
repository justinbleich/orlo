import { Text, View } from "react-native";
import { colors, spacing } from "../../src/theme/tokens";

export default function OnboardingDetails() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, padding: spacing.xl, gap: spacing.md }}>
      <Text style={{ color: colors.ink, fontSize: 28, fontWeight: "700" }}>Checklist Details</Text>
      <Text style={{ color: colors.muted, fontSize: 16 }}>
        Tune each milestone before exporting the screen back to the app.
      </Text>
    </View>
  );
}
