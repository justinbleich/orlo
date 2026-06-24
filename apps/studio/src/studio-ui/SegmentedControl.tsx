import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle } from "@base-ui/react/toggle";
import { cn } from "./cn";

export type SegmentOption<T extends string> = {
  value: T;
  /** Icon or short text shown in the segment. */
  content: React.ReactNode;
  title: string;
};

/**
 * A single-select segmented control for small enum properties (flexDirection,
 * textAlign, sizing mode). One segment is always pressed; selecting another
 * switches. Mixed/multi-select shows no active segment.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T | undefined;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  disabled?: boolean;
}) {
  return (
    <ToggleGroup
      value={value ? [value] : []}
      onValueChange={(groupValue) => {
        const next = groupValue[0] as T | undefined;
        if (next) onChange(next);
      }}
      disabled={disabled}
      className={cn(
        "flex h-7 items-center gap-2xs rounded-sm border border-line bg-chrome-2 p-2xs",
        disabled && "opacity-50",
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Toggle
            key={option.value}
            value={option.value}
            title={option.title}
            aria-label={option.title}
            className={cn(
              "flex h-full flex-1 items-center justify-center rounded-xs text-xs",
              "transition-colors focus-visible:outline-none",
              active
                ? "bg-raised text-ink shadow-control"
                : "text-ink-dim hover:text-ink",
            )}
          >
            {option.content}
          </Toggle>
        );
      })}
    </ToggleGroup>
  );
}
