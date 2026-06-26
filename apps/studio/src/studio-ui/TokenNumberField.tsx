import { forwardRef, useState } from "react";
import { Link2, Link2Off } from "lucide-react";
import { NumberField } from "./NumberField";
import { cn } from "./cn";
import type { EditLifecycle } from "./controls";
import { TokenPickerPopover, type TokenPickerOption } from "./TokenPickerPopover";

export type NumberTokenOption = { id: string; name: string; value: number };

/**
 * NumberField wrapped with a token picker trigger. The trailing link button
 * opens the picker; when a token is linked the button glows accent and the
 * number input shows the resolved value with a token tooltip. Custom-tab edits
 * (or direct typing in the number field) auto-detach.
 */
export function TokenNumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  mixed,
  placeholder,
  onEditStart,
  onEditEnd,
  onEditCancel,
  category,
  tokens,
  linkedTokenId,
  defaultPromoteName,
  onLink,
  onUnlink,
  onPromote,
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
  category: "spacing" | "fontSize";
  tokens: NumberTokenOption[];
  linkedTokenId: string | undefined;
  defaultPromoteName: string;
  onLink: (tokenId: string) => void;
  onUnlink: () => void;
  onPromote: (name: string) => void;
} & EditLifecycle) {
  const [open, setOpen] = useState(false);
  const linked = linkedTokenId ? tokens.find((t) => t.id === linkedTokenId) : undefined;

  const pickerTokens: TokenPickerOption[] = tokens.map((t) => ({
    id: t.id,
    name: t.name,
    category,
    value: t.value,
  }));

  // When a token is linked, replace the number field with a chip showing the
  // token name + resolved value (matches the color field's inline-name affordance
  // so tokens read as first-class values, not a hidden binding).
  if (linked) {
    return (
      <div
        className={cn(
          "flex h-7 min-w-0 items-center rounded-sm border border-accent-line/60 bg-chrome-2 pl-control-y pr-2xs",
          "transition-colors focus-within:border-accent-line focus-within:bg-raised hover:bg-raised",
          disabled && "opacity-50",
        )}
      >
        <TokenPickerPopover
          open={open}
          onOpenChange={setOpen}
          category={category}
          tokens={pickerTokens}
          linkedTokenId={linkedTokenId}
          defaultPromoteName={defaultPromoteName}
          hasValue={value !== undefined}
          onLink={onLink}
          onUnlink={onUnlink}
          onPromote={onPromote}
          trigger={
            <TokenLinkTrigger
              linked
              linkedName={linked.name}
              disabled={disabled}
            />
          }
          customTab={
            <CustomNumberTab
              value={value}
              min={min}
              max={max}
              step={step}
              onChange={(v) => {
                onEditStart?.();
                onUnlink();
                onChange(v);
              }}
            />
          }
        />
        <span
          title={`${linked.name} · ${linked.value}`}
          className="ml-sm min-w-0 flex-1 truncate font-mono text-xs text-accent"
        >
          {linked.name}
          <span className="ml-xs text-ink-faint">{linked.value}</span>
        </span>
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
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2xs">
      <div className="min-w-0 flex-1">
        <NumberField
          label={label}
          value={value}
          onChange={(next) => {
            // Direct numeric edits auto-detach any link.
            if (linkedTokenId) onUnlink();
            onChange(next);
          }}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          mixed={mixed}
          placeholder={placeholder}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
          onEditCancel={onEditCancel}
        />
      </div>
      <TokenPickerPopover
        open={open}
        onOpenChange={setOpen}
        category={category}
        tokens={pickerTokens}
        linkedTokenId={linkedTokenId}
        defaultPromoteName={defaultPromoteName}
        hasValue={value !== undefined}
        onLink={onLink}
        onUnlink={onUnlink}
        onPromote={onPromote}
        trigger={
          <TokenLinkTrigger linked={false} disabled={disabled} />
        }
        customTab={
          <CustomNumberTab
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(v) => {
              onEditStart?.();
              if (linkedTokenId) onUnlink();
              onChange(v);
            }}
          />
        }
      />
    </div>
  );
}

/** Compact link-icon trigger button; matches the swatch trigger's footprint. */
const TokenLinkTrigger = forwardRef<
  HTMLButtonElement,
  {
    linked: boolean;
    linkedName?: string;
    disabled?: boolean;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function TokenLinkTrigger({ linked, linkedName, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      title={linked ? `Linked to ${linkedName} — change` : "Link to token"}
      aria-label={linked ? `Linked to ${linkedName}` : "Link to token"}
      aria-pressed={linked}
      {...rest}
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded-sm border",
        "transition-colors outline-none focus-visible:border-accent-line",
        "disabled:cursor-not-allowed disabled:opacity-50",
        linked
          ? "border-accent bg-accent text-white shadow-control hover:bg-accent/90"
          : "border-line bg-chrome-2 text-ink-faint hover:bg-raised hover:text-ink",
      )}
    >
      <Link2 size={12} aria-hidden="true" />
      {linked && (
        <span
          className="absolute -bottom-px -right-px size-1.5 rounded-full bg-accent ring-1 ring-chrome"
          aria-hidden="true"
        />
      )}
    </button>
  );
});

function CustomNumberTab({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number | undefined;
  min?: number;
  max?: number;
  step?: number;
  onChange: (next: number | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-sm">
      <NumberField
        label="N"
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
      />
    </div>
  );
}
