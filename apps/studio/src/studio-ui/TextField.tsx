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
  className,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
} & EditLifecycle & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      {...props}
      onFocus={(event) => {
        onEditStart?.();
        onFocus?.(event);
      }}
      onBlur={(event) => {
        onEditEnd?.();
        onBlur?.(event);
      }}
      onChange={(e) => {
        onEditStart?.();
        onChange(e.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onEditCancel?.();
        onKeyDown?.(event);
      }}
      className={cn(controlClass, "placeholder:text-ink-faint", className)}
    />
  );
}
