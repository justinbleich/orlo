import { useState } from "react";
import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import { cn } from "./cn";
import type { EditLifecycle } from "./controls";

/**
 * Scrubbable number input — the inspector's workhorse. The leading label/icon is
 * a ScrubArea: drag horizontally to change the value (Figma's core inspector
 * gesture). Empty maps to `undefined` so styles can be cleared; `mixed` shows a
 * dimmed placeholder for multi-select (forward-compat).
 */
export function NumberField({
  label,
  ariaLabel,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  mixed,
  placeholder,
  onEditStart,
  onEditEnd,
  onEditCancel,
}: {
  label: React.ReactNode;
  ariaLabel?: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  mixed?: boolean;
  placeholder?: string;
} & EditLifecycle) {
  // Base UI keeps the visible input text in internal state and does not re-sync
  // it when the controlled `value` changes from outside (undo, discard, tokens),
  // leaving stale text. While idle there is no caret to preserve, so key the Root
  // by value to remount on external changes; while the user is editing, keep the
  // mount stable and let internal state ride.
  const [interacting, setInteracting] = useState(false);
  return (
    <BaseNumberField.Root
      key={interacting ? "editing" : `v${mixed ? "mixed" : value ?? "empty"}`}
      value={mixed ? null : value ?? null}
      onValueChange={(next) => {
        onEditStart?.();
        onChange(next ?? undefined);
      }}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onFocusCapture={() => {
        setInteracting(true);
        onEditStart?.();
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) {
          setInteracting(false);
          onEditEnd?.();
        }
      }}
      onPointerDownCapture={() => {
        setInteracting(true);
        onEditStart?.();
      }}
      onPointerUpCapture={(event) => {
        // Scrub end: safe to resume keying by value. After click-to-focus the
        // input keeps focus — stay in editing mode so typing doesn't remount.
        if (!event.currentTarget.contains(document.activeElement)) setInteracting(false);
        onEditEnd?.();
      }}
      onPointerCancelCapture={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) setInteracting(false);
        onEditCancel?.();
      }}
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
          aria-label={ariaLabel}
          placeholder={mixed ? "Mixed" : placeholder}
          onFocus={(event) => {
            const input = event.currentTarget;
            requestAnimationFrame(() => input.select());
          }}
          onPointerUp={(event) => {
            if (event.currentTarget === document.activeElement) event.preventDefault();
          }}
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
