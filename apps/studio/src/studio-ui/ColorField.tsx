import { cn } from "./cn";
import type { EditLifecycle } from "./controls";

/**
 * A color control: a swatch that opens the native picker plus the hex value.
 * `value` undefined renders an empty (transparent) swatch and blank hex. Editing
 * either commits the hex string upward.
 */
export function ColorField({
  value,
  onChange,
  disabled,
  onEditStart,
  onEditEnd,
  onEditCancel,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
} & EditLifecycle) {
  const hex = value ?? "";
  return (
    <div
      className={cn(
        "flex h-7 items-center rounded-sm border border-line bg-chrome-2 pl-control-y pr-sm",
        "transition-colors focus-within:border-accent-line focus-within:bg-raised hover:bg-raised",
        disabled && "opacity-50",
      )}
      onFocusCapture={onEditStart}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) {
          onEditEnd?.();
        }
      }}
    >
      <span className="relative inline-flex size-swatch shrink-0 overflow-hidden rounded-xs ring-1 ring-inset ring-line">
        {/* checkerboard backing shows through when no/transparent color */}
        <span className="color-checker absolute inset-0 opacity-40" />
        <span
          className="absolute inset-0"
          style={{ background: value ?? "transparent" }}
        />
        <input
          type="color"
          value={value ?? "#000000"}
          disabled={disabled}
          onChange={(e) => {
            onEditStart?.();
            onChange(e.target.value);
          }}
          aria-label="Pick color"
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </span>
      <input
        type="text"
        value={hex}
        placeholder="—"
        disabled={disabled}
        onChange={(e) => {
          onEditStart?.();
          onChange(e.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onEditCancel?.();
        }}
        spellCheck={false}
        className={cn(
          "ml-sm h-full w-full min-w-0 bg-transparent text-sm uppercase tabular-nums text-ink",
          "placeholder:text-ink-faint focus-visible:outline-none disabled:cursor-not-allowed",
        )}
      />
    </div>
  );
}
