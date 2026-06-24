import { cn } from "./cn";

/** Two-column grid for compact paired controls (e.g. W / H, padding pairs). */
export function FieldGrid({
  columns = 2,
  children,
}: {
  columns?: 2 | 3;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-xs",
        columns === 2 ? "grid-cols-2" : "grid-cols-3",
      )}
    >
      {children}
    </div>
  );
}

/**
 * A labeled control. `label` is the small leading caption; the control is the
 * child. `stacked` puts the label above (full-width fields like Name/Text);
 * the default is a compact inline label sized for grid cells.
 */
export function Field({
  label,
  htmlFor,
  stacked = false,
  children,
}: {
  label: string;
  htmlFor?: string;
  stacked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        "flex min-w-0 text-xs text-ink-dim",
        stacked ? "flex-col gap-xs" : "flex-col gap-control",
      )}
    >
      <span className="truncate">{label}</span>
      {children}
    </label>
  );
}
