import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import { cn } from "./cn";

/**
 * Scrubbable number input — the inspector's workhorse. The leading label/icon is
 * a ScrubArea: drag horizontally to change the value (Figma's core inspector
 * gesture). Empty maps to `undefined` so styles can be cleared; `mixed` shows a
 * dimmed placeholder for multi-select (forward-compat).
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  mixed,
  placeholder,
}: {
  label: React.ReactNode;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  mixed?: boolean;
  placeholder?: string;
}) {
  return (
    <BaseNumberField.Root
      value={mixed ? null : value ?? null}
      onValueChange={(next) => onChange(next ?? undefined)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={cn(
        "group flex h-7 items-center rounded-sm border border-line bg-chrome-2",
        "transition-colors focus-within:border-accent-line focus-within:bg-raised",
        "hover:bg-raised",
        disabled && "opacity-50",
      )}
    >
      <BaseNumberField.ScrubArea
        className={cn(
          "flex h-full shrink-0 select-none items-center justify-center px-sm",
          "text-xs text-ink-faint",
          disabled ? "cursor-not-allowed" : "cursor-ew-resize hover:text-ink-dim",
        )}
      >
        <BaseNumberField.ScrubAreaCursor />
        {label}
      </BaseNumberField.ScrubArea>
      <BaseNumberField.Group className="flex min-w-0 flex-1">
        <BaseNumberField.Input
          placeholder={mixed ? "Mixed" : placeholder}
          className={cn(
            "h-full w-full min-w-0 bg-transparent pr-sm text-sm tabular-nums text-ink",
            "placeholder:text-ink-faint focus-visible:outline-none",
            mixed && "placeholder:italic",
          )}
        />
      </BaseNumberField.Group>
    </BaseNumberField.Root>
  );
}
