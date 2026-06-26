/**
 * Category-generic token picker popover. The trigger is provided by the caller
 * (a swatch for color, a link-icon button for spacing/fontSize). The body
 * renders a Tokens / Custom tabbed pane:
 *   - Tokens: swatch grid (color) or chip list (spacing/fontSize) of available
 *     tokens, plus a "Create token from value" affordance that seeds a name and
 *     promotes the current literal in one action.
 *   - Custom: caller-provided editor (color picker, number input, …) so the
 *     popover hosts the only literal-edit path for the field.
 *
 * Presentation only. Caller wires `tokens`, `linkedTokenId`, link/unlink/promote,
 * and the custom editor against the document store.
 */
import { type ReactNode, useEffect, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Check, Link2Off, Plus, X } from "lucide-react";
import { cn } from "./cn";

export type TokenPickerOption =
  | { id: string; name: string; category: "color"; value: string }
  | { id: string; name: string; category: "spacing" | "fontSize"; value: number };

export interface TokenPickerPopoverProps {
  /** Open state — controlled so callers can close on link/promote. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Anchor element. `children` is rendered inside Popover.Trigger. */
  trigger: ReactNode;
  /** Picker semantics. */
  category: "color" | "spacing" | "fontSize";
  tokens: TokenPickerOption[];
  linkedTokenId: string | undefined;
  /** A default name (e.g. `color1`, `space1`) seeded into the create-from-value
   *  input when the user opens it. */
  defaultPromoteName: string;
  /** Whether the current literal value is set — controls the promote button. */
  hasValue: boolean;
  onLink: (tokenId: string) => void;
  onUnlink: () => void;
  onPromote: (name: string) => void;
  /** Custom-tab content for editing the literal value. Caller is responsible for
   *  auto-unlinking before applying changes when there is a current link. */
  customTab: ReactNode;
}

const CATEGORY_LABEL: Record<TokenPickerPopoverProps["category"], string> = {
  color: "Color",
  spacing: "Spacing",
  fontSize: "Type",
};

export function TokenPickerPopover({
  open,
  onOpenChange,
  trigger,
  category,
  tokens,
  linkedTokenId,
  defaultPromoteName,
  hasValue,
  onLink,
  onUnlink,
  onPromote,
  customTab,
}: TokenPickerPopoverProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger render={trigger as never} />
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup
            className={cn(
              "studio-popup w-[260px] rounded-md border border-line bg-chrome shadow-popover outline-none",
            )}
          >
            <PickerBody
              category={category}
              tokens={tokens}
              linkedTokenId={linkedTokenId}
              defaultPromoteName={defaultPromoteName}
              hasValue={hasValue}
              onLink={(id) => {
                onLink(id);
                onOpenChange(false);
              }}
              onUnlink={onUnlink}
              onPromote={(name) => {
                onPromote(name);
                onOpenChange(false);
              }}
              customTab={customTab}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PickerBody({
  category,
  tokens,
  linkedTokenId,
  defaultPromoteName,
  hasValue,
  onLink,
  onUnlink,
  onPromote,
  customTab,
}: Omit<TokenPickerPopoverProps, "open" | "onOpenChange" | "trigger">) {
  const [tab, setTab] = useState<"tokens" | "custom">("tokens");
  const linked = linkedTokenId ? tokens.find((t) => t.id === linkedTokenId) : undefined;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-xs border-b border-line-soft px-control py-xs">
        <span className="eyebrow">{CATEGORY_LABEL[category]} token</span>
        <div className="ml-auto flex h-6 items-center gap-2xs rounded-sm border border-line bg-chrome-2 p-2xs">
          <PickerTab active={tab === "tokens"} onClick={() => setTab("tokens")}>
            Tokens
          </PickerTab>
          <PickerTab active={tab === "custom"} onClick={() => setTab("custom")}>
            Custom
          </PickerTab>
        </div>
      </div>
      {linked && (
        <div className="flex items-center gap-xs border-b border-line-soft px-control py-xs text-xs">
          <span className="text-ink-faint">Linked to</span>
          <span className="font-mono text-accent">{linked.name}</span>
          <button
            type="button"
            onClick={onUnlink}
            className={cn(
              "ml-auto inline-flex items-center gap-2xs rounded-xs px-xs py-2xs text-ink-faint",
              "transition-colors hover:bg-raised hover:text-ink",
            )}
          >
            <Link2Off size={11} aria-hidden="true" />
            Unlink
          </button>
        </div>
      )}
      <div className="flex flex-col gap-control p-control">
        {tab === "tokens" ? (
          <TokensTab
            category={category}
            tokens={tokens}
            linkedTokenId={linkedTokenId}
            defaultPromoteName={defaultPromoteName}
            hasValue={hasValue}
            onLink={onLink}
            onPromote={onPromote}
          />
        ) : (
          customTab
        )}
      </div>
    </div>
  );
}

function PickerTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-full items-center justify-center rounded-xs px-sm text-xs",
        "transition-colors focus-visible:outline-none",
        active ? "bg-raised text-ink shadow-control" : "text-ink-dim hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function TokensTab({
  category,
  tokens,
  linkedTokenId,
  defaultPromoteName,
  hasValue,
  onLink,
  onPromote,
}: {
  category: "color" | "spacing" | "fontSize";
  tokens: TokenPickerOption[];
  linkedTokenId: string | undefined;
  defaultPromoteName: string;
  hasValue: boolean;
  onLink: (tokenId: string) => void;
  onPromote: (name: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState(defaultPromoteName);
  const [error, setError] = useState<string | null>(null);

  // Reset the draft to the latest default whenever the trigger conditions
  // change (popover reopened, sibling tokens added, current value changed).
  useEffect(() => {
    if (!creating) setDraftName(defaultPromoteName);
  }, [defaultPromoteName, creating]);

  const submit = () => {
    const name = draftName.trim().replace(/-/g, ".");
    if (!name) return setError("Name required");
    try {
      onPromote(name);
      setCreating(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-sm">
      {tokens.length === 0 ? (
        <p className="m-0 text-xs text-ink-faint">
          No {CATEGORY_LABEL[category].toLowerCase()} tokens yet. Create one from the current value below.
        </p>
      ) : category === "color" ? (
        <ColorSwatchGrid
          tokens={tokens as Extract<TokenPickerOption, { category: "color" }>[]}
          linkedTokenId={linkedTokenId}
          onLink={onLink}
        />
      ) : (
        <NumberChipList
          tokens={tokens as Extract<TokenPickerOption, { category: "spacing" | "fontSize" }>[]}
          linkedTokenId={linkedTokenId}
          onLink={onLink}
        />
      )}
      {creating ? (
        <div className="flex items-center gap-xs">
          <input
            autoFocus
            value={draftName}
            onChange={(e) => {
              setDraftName(e.target.value.replace(/-/g, "."));
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              else if (e.key === "Escape") {
                setCreating(false);
                setDraftName(defaultPromoteName);
                setError(null);
              }
            }}
            placeholder="tokenName"
            spellCheck={false}
            className={cn(
              "h-7 min-w-0 flex-1 rounded-sm border bg-chrome-2 px-sm font-mono text-xs text-ink",
              "placeholder:text-ink-faint outline-none focus-visible:border-accent-line focus-visible:bg-raised",
              error ? "border-amber" : "border-line",
            )}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draftName.trim()}
            className={cn(
              "inline-flex h-7 items-center rounded-sm border border-accent-line bg-accent-soft px-sm text-xs text-accent",
              "transition-colors hover:bg-accent hover:text-white",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-soft disabled:hover:text-accent",
            )}
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setDraftName(defaultPromoteName);
              setError(null);
            }}
            title="Cancel"
            aria-label="Cancel"
            className="inline-flex size-7 items-center justify-center rounded-sm text-ink-faint hover:bg-raised hover:text-ink"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={!hasValue}
          title={hasValue ? "Create a token from the current value" : "Set a value first"}
          className={cn(
            "inline-flex h-7 items-center gap-xs rounded-sm border border-dashed border-line bg-chrome-2 px-sm text-xs text-ink-dim",
            "transition-colors hover:border-accent-line hover:text-ink",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:text-ink-dim",
          )}
        >
          <Plus size={11} aria-hidden="true" />
          <span>Create token from value</span>
        </button>
      )}
      {error && <p className="m-0 text-xs text-amber">{error}</p>}
    </div>
  );
}

function ColorSwatchGrid({
  tokens,
  linkedTokenId,
  onLink,
}: {
  tokens: Extract<TokenPickerOption, { category: "color" }>[];
  linkedTokenId: string | undefined;
  onLink: (tokenId: string) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-2xs">
      {tokens.map((token) => {
        const active = token.id === linkedTokenId;
        return (
          <button
            key={token.id}
            type="button"
            onClick={() => onLink(token.id)}
            title={token.name}
            aria-label={token.name}
            aria-pressed={active}
            className={cn(
              "relative aspect-square w-full overflow-hidden rounded-xs ring-1 ring-inset ring-line",
              "transition-shadow outline-none hover:ring-ink-faint focus-visible:ring-accent-line",
              active && "ring-accent shadow-control",
            )}
          >
            <span className="color-checker absolute inset-0 opacity-40" aria-hidden="true" />
            <span
              className="absolute inset-0"
              style={{ background: token.value }}
              aria-hidden="true"
            />
            {active && (
              <span className="absolute inset-0 flex items-center justify-center text-white mix-blend-difference">
                <Check size={11} strokeWidth={2.5} aria-hidden="true" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function NumberChipList({
  tokens,
  linkedTokenId,
  onLink,
}: {
  tokens: Extract<TokenPickerOption, { category: "spacing" | "fontSize" }>[];
  linkedTokenId: string | undefined;
  onLink: (tokenId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2xs">
      {tokens.map((token) => {
        const active = token.id === linkedTokenId;
        return (
          <button
            key={token.id}
            type="button"
            onClick={() => onLink(token.id)}
            title={token.name}
            aria-pressed={active}
            className={cn(
              "flex h-7 items-center gap-sm rounded-sm border bg-chrome-2 px-sm text-xs",
              "transition-colors outline-none",
              active
                ? "border-accent-line bg-accent-soft text-ink shadow-control"
                : "border-line text-ink-dim hover:bg-raised hover:text-ink focus-visible:border-accent-line",
            )}
          >
            <span className="flex-1 truncate text-left font-mono">{token.name}</span>
            <span className="shrink-0 tabular-nums text-ink-faint">{token.value}</span>
            {active && <Check size={11} strokeWidth={2.5} className="text-accent" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
