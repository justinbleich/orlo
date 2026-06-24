import { controlClass } from "./controls";
import { cn } from "./cn";
import type { EditLifecycle } from "./controls";

/** Plain text input on the shared control chrome. */
export function TextField({
  value,
  onChange,
  placeholder,
  disabled,
  id,
  onEditStart,
  onEditEnd,
  onEditCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
} & EditLifecycle) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={onEditStart}
      onBlur={onEditEnd}
      onChange={(e) => {
        onEditStart?.();
        onChange(e.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onEditCancel?.();
      }}
      className={cn(controlClass, "placeholder:text-ink-faint")}
    />
  );
}
