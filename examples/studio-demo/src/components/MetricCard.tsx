import { Text, View } from "react-native";
import { colors, radius, spacing } from "../theme/tokens";

type MetricCardProps = {
  label: string;
  value: string;
  tone?: "good" | "warn";
};

export function MetricCard({ label, value, tone = "good" }: MetricCardProps) {
  const accent = tone === "good" ? colors.success : colors.warning;
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.line,
        borderRadius: radius.md,
        borderWidth: 1,
        gap: spacing.xs,
        padding: spacing.lg
      }}
    >
      <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      <Text style={{ color: accent, fontSize: 30, fontWeight: "800" }}>{value}</Text>
    </View>
  );
}
