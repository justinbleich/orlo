import { controlClass } from "./controls";
import { cn } from "./cn";

/** Plain text input on the shared control chrome. */
export function TextField({
  value,
  onChange,
  placeholder,
  disabled,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(controlClass, "placeholder:text-ink-faint")}
    />
  );
}
