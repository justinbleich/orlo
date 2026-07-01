import { Text, View } from "react-native";
import { colors, spacing } from "../../src/theme/tokens";

export default function AccountSettings() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, padding: spacing.xl, gap: spacing.md }}>
      <Text style={{ color: colors.ink, fontSize: 28, fontWeight: "700" }}>Account Settings</Text>
      <Text style={{ color: colors.muted, fontSize: 16 }}>
        Confirm profile, notifications, and billing preferences.
      </Text>
    </View>
  );
}
