import { Check, ChevronsUpDown } from "lucide-react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { controlClass } from "./controls";
import { cn } from "./cn";

export type SelectOption<T extends string> = { value: T; label: string };

/** Dropdown for enum properties with more options than fit a segmented control. */
export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder = "—",
  disabled,
}: {
  value: T | undefined;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <BaseSelect.Root
      value={value ?? null}
      onValueChange={(next) => next != null && onChange(next as T)}
      disabled={disabled}
      items={options}
    >
      <BaseSelect.Trigger
        className={cn(
          controlClass,
          "flex items-center justify-between gap-sm text-left",
        )}
      >
        <BaseSelect.Value>
          {(val: T | null) =>
            options.find((o) => o.value === val)?.label ?? (
              <span className="text-ink-faint">{placeholder}</span>
            )
          }
        </BaseSelect.Value>
        <BaseSelect.Icon className="shrink-0 text-ink-faint">
          <ChevronsUpDown size={14} aria-hidden="true" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="z-50">
          <BaseSelect.Popup
            className={cn(
              "studio-popup min-w-[var(--anchor-width)] rounded-md border border-line bg-chrome p-control",
              "shadow-popover outline-none",
            )}
          >
            {options.map((option) => (
              <BaseSelect.Item
                key={option.value}
                value={option.value}
                className={cn(
                  "flex cursor-default items-center justify-between gap-sm rounded-sm py-control-y pl-sm pr-xs",
                  "text-sm text-ink-dim outline-none",
                  "data-[highlighted]:bg-raised data-[highlighted]:text-ink",
                  "data-[selected]:text-ink",
                )}
              >
                <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                <BaseSelect.ItemIndicator className="text-accent">
                  <Check size={14} aria-hidden="true" />
                </BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
