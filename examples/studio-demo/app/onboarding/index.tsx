import { Text, View } from "react-native";
import { colors, spacing } from "../../src/theme/tokens";

export default function OnboardingStart() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, padding: spacing.xl, gap: spacing.md }}>
      <Text style={{ color: colors.ink, fontSize: 30, fontWeight: "700" }}>Start Strong</Text>
      <Text style={{ color: colors.muted, fontSize: 16 }}>
        A guided checklist for the first session.
      </Text>
    </View>
  );
}
