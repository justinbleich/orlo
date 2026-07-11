import { forwardRef, useState } from "react";
import { Link2Off } from "lucide-react";
import { cn } from "./cn";
import { ColorPickerPanel } from "./ColorPicker";
import type { EditLifecycle } from "./controls";
import { TokenPickerPopover, type TokenPickerOption } from "./TokenPickerPopover";

export type ColorTokenOption = { id: string; name: string; value: string };

/**
 * Color control with a Figma-style token picker. The swatch is the popover
 * trigger; the hex text input shows the linked token's name when linked, or
 * the literal hex otherwise. Editing the literal (typing in the field or via
 * the Custom tab) auto-detaches any current link.
 *
 * Presentation only: the caller wires `tokens`, `linkedTokenId`, and the link/
 * unlink/promote callbacks against the document store.
 */
export function TokenColorField({
  value,
  ariaLabel,
  onChange,
  disabled,
  onEditStart,
  onEditEnd,
  onEditCancel,
  tokens,
  linkedTokenId,
  defaultPromoteName,
  onLink,
  onUnlink,
  onPromote,
}: {
  value: string | undefined;
  ariaLabel?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  tokens: ColorTokenOption[];
  linkedTokenId: string | undefined;
  defaultPromoteName: string;
  onLink: (tokenId: string) => void;
  onUnlink: () => void;
  onPromote: (name: string) => void;
} & EditLifecycle) {
  const hex = value ?? "";
  const linked = linkedTokenId ? tokens.find((t) => t.id === linkedTokenId) : undefined;
  const [open, setOpen] = useState(false);

  const pickerTokens: TokenPickerOption[] = tokens.map((t) => ({
    id: t.id,
    name: t.name,
    category: "color",
    value: t.value,
  }));

  return (
    <div
      className={cn(
        "flex h-7 items-center rounded-sm border border-line bg-chrome-2 pl-control-y pr-sm",
        "transition-colors focus-within:border-accent-line focus-within:bg-raised hover:bg-raised",
        linked && "border-accent-line/60",
        disabled && "opacity-50",
      )}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) {
          onEditEnd?.();
        }
      }}
    >
      <TokenPickerPopover
        open={open}
        onOpenChange={setOpen}
        category="color"
        tokens={pickerTokens}
        linkedTokenId={linkedTokenId}
        defaultPromoteName={defaultPromoteName}
        hasValue={!!value}
        onLink={onLink}
        onUnlink={onUnlink}
        onPromote={onPromote}
        trigger={
          <ColorSwatchTrigger
            disabled={disabled}
            ariaLabel={ariaLabel}
            value={value}
            linked={!!linked}
            linkedName={linked?.name}
          />
        }
        customTab={
          <CustomColorTab
            value={value}
            onEditStart={onEditStart}
            onEditEnd={onEditEnd}
            onEditCancel={onEditCancel}
            onChange={(v) => {
              onEditStart?.();
              if (linkedTokenId) onUnlink();
              onChange(v);
            }}
          />
        }
      />
      <input
        type="text"
        aria-label={ariaLabel}
        value={linked ? linked.name : hex}
        placeholder="—"
        disabled={disabled}
        readOnly={!!linked}
        onFocus={() => onEditStart?.()}
        onChange={(e) => {
          onEditStart?.();
          if (linkedTokenId) onUnlink();
          onChange(e.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onEditCancel?.();
        }}
        spellCheck={false}
        title={linked ? `Linked to ${linked.name}` : value}
        className={cn(
          "ml-sm h-full w-full min-w-0 bg-transparent text-sm text-ink",
          linked ? "cursor-default font-mono text-accent" : "uppercase tabular-nums",
          "placeholder:text-ink-faint focus-visible:outline-none disabled:cursor-not-allowed",
        )}
      />
      {linked && (
        <button
          type="button"
          onClick={onUnlink}
          title="Unlink token"
          aria-label="Unlink token"
          className={cn(
            "ml-xs inline-flex size-5 shrink-0 items-center justify-center rounded-xs text-ink-faint",
            "hover:bg-raised hover:text-ink",
          )}
        >
          <Link2Off size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Trigger swatch — separate component so Popover.Trigger's `render` can hand
 *  it a button props bag plus a forwarded ref. */
const ColorSwatchTrigger = forwardRef<
  HTMLButtonElement,
  {
    disabled?: boolean;
    ariaLabel?: string;
    value: string | undefined;
    linked: boolean;
    linkedName?: string;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function ColorSwatchTrigger({ disabled, ariaLabel, value, linked, linkedName, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-label={linked ? `Linked to ${linkedName} — change` : `Pick ${ariaLabel?.toLowerCase() ?? "color or token"}`}
      {...rest}
      className={cn(
        "relative inline-flex size-swatch shrink-0 cursor-pointer overflow-hidden rounded-xs ring-1 ring-inset ring-line",
        "outline-none focus-visible:ring-accent-line disabled:cursor-not-allowed",
      )}
    >
      <span className="color-checker absolute inset-0 opacity-40" aria-hidden="true" />
      <span
        className="absolute inset-0"
        style={{ background: value ?? "transparent" }}
        aria-hidden="true"
      />
      {linked && (
        <span
          className="absolute -bottom-px -right-px size-2 rounded-full bg-accent ring-1 ring-chrome"
          aria-hidden="true"
        />
      )}
    </button>
  );
});

function CustomColorTab({
  value,
  onChange,
  onEditStart,
  onEditEnd,
  onEditCancel,
}: {
  value: string | undefined;
  onChange: (next: string) => void;
} & EditLifecycle) {
  return (
    <ColorPickerPanel
      value={value}
      onChange={onChange}
      onEditStart={onEditStart}
      onEditEnd={onEditEnd}
      onEditCancel={onEditCancel}
    />
  );
}
