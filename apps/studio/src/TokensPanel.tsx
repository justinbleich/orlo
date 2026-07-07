/**
 * Tokens panel — sections per category (Color, Spacing, Type), inline name
 * validation, usage counts (clickable to select linked nodes), safe delete,
 * and drag-reorder within a category.
 */
import { useMemo, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import {
  useDocumentStore,
  type DesignToken,
  type NodeId,
  type TokenCategory,
} from "@rn-canvas/document";
import { ColorPickerPopover, cn } from "./studio-ui";

const IDENTIFIER = /^[A-Za-z_$][\w$]*(\.[\w$]+)*$/;
const CATEGORY_LABEL: Record<TokenCategory, string> = {
  color: "Color",
  spacing: "Spacing",
  fontSize: "Type",
};
const CATEGORY_ORDER: TokenCategory[] = ["color", "spacing", "fontSize"];

/** Hyphens are friendlier to type than dots; we silently rewrite them so the
 *  user can paste/typo `color-primary-500` and get a valid dotted name. */
function normalizeName(input: string): string {
  return input.replace(/-/g, ".");
}

export function TokensPanel({ onCreate }: { onCreate: (category: TokenCategory) => void }) {
  const tokens = useDocumentStore((s) => s.tokens);
  const [filter, setFilter] = useState("");
  const tokenList = Object.values(tokens);
  const filtered = filter.trim()
    ? tokenList.filter((t) => t.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : tokenList;

  if (tokenList.length === 0) {
    return (
      <p className="m-0 text-sm text-ink-faint">
        Add a token, then link a style value to it from the Inspector.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-control">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter tokens…"
        spellCheck={false}
        className={cn(
          "h-7 w-full rounded-sm border border-line bg-chrome-2 px-sm text-sm text-ink",
          "placeholder:text-ink-faint transition-colors",
          "hover:bg-raised focus-visible:border-accent-line focus-visible:bg-raised focus-visible:outline-none",
        )}
      />
      {CATEGORY_ORDER.map((category) => {
        const rows = filtered.filter((t) => t.category === category);
        if (rows.length === 0 && filter.trim()) return null;
        return (
          <CategoryGroup
            key={category}
            category={category}
            tokens={rows}
            onAdd={() => onCreate(category)}
          />
        );
      })}
    </div>
  );
}

function CategoryGroup({
  category,
  tokens,
  onAdd,
}: {
  category: TokenCategory;
  tokens: DesignToken[];
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-xs">
      <div className="flex items-center gap-xs">
        <span className="eyebrow flex-1">{CATEGORY_LABEL[category]}</span>
        <button
          type="button"
          onClick={onAdd}
          title={`Add ${CATEGORY_LABEL[category].toLowerCase()} token`}
          aria-label={`Add ${CATEGORY_LABEL[category].toLowerCase()} token`}
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-xs text-ink-faint",
            "transition-colors hover:bg-raised hover:text-ink",
          )}
        >
          <Plus size={13} aria-hidden="true" />
        </button>
      </div>
      {tokens.length === 0 ? (
        <p className="m-0 px-xs text-xs text-ink-faint">
          No {CATEGORY_LABEL[category].toLowerCase()} tokens.
        </p>
      ) : (
        <TokenList tokens={tokens} />
      )}
    </div>
  );
}

function TokenList({ tokens }: { tokens: DesignToken[] }) {
  const reorderToken = useDocumentStore((s) => s.reorderToken);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2xs">
      {tokens.map((token) => (
        <div
          key={token.id}
          onDragOver={(e) => {
            if (!dragId || dragId === token.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropTargetId(token.id);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) return;
            setDropTargetId((cur) => (cur === token.id ? null : cur));
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (!dragId || dragId === token.id) return;
            try {
              reorderToken(dragId, token.id);
            } catch {
              /* cross-category drag — ignore */
            }
            setDragId(null);
            setDropTargetId(null);
          }}
          onDragEnd={() => {
            setDragId(null);
            setDropTargetId(null);
          }}
          className={cn(
            "rounded-sm",
            dropTargetId === token.id && "ring-1 ring-accent-line",
            dragId === token.id && "opacity-40",
          )}
        >
          <TokenRow token={token} onDragStart={() => setDragId(token.id)} />
        </div>
      ))}
    </div>
  );
}

function TokenRow({ token, onDragStart }: { token: DesignToken; onDragStart: () => void }) {
  const tokens = useDocumentStore((s) => s.tokens);
  const updateToken = useDocumentStore((s) => s.updateToken);
  const removeToken = useDocumentStore((s) => s.removeToken);
  const setSelection = useDocumentStore((s) => s.setSelection);
  const getTokenUsage = useDocumentStore((s) => s.getTokenUsage);
  const [nameDraft, setNameDraft] = useState(token.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Keep the input in sync when the underlying token name changes externally
  // (e.g. undo) and we're not actively editing.
  if (nameDraft !== token.name && nameError === null && document.activeElement?.tagName !== "INPUT") {
    setNameDraft(token.name);
  }

  const validate = (next: string): string | null => {
    if (!next) return "Name required";
    if (!IDENTIFIER.test(next)) return "Letters, digits, _, $ or . segments";
    const dupe = Object.values(tokens).some(
      (t) => t.category === token.category && t.name === next && t.id !== token.id,
    );
    if (dupe) return "Duplicate name in this category";
    return null;
  };

  const commitName = () => {
    const err = validate(nameDraft);
    if (err) {
      setNameDraft(token.name);
      setNameError(null);
      return;
    }
    if (nameDraft !== token.name) {
      try {
        updateToken(token.id, { name: nameDraft });
      } catch (e) {
        setNameDraft(token.name);
        setNameError(e instanceof Error ? e.message : "Invalid");
      }
    }
  };

  const usage = useMemo(() => getTokenUsage(token.id), [getTokenUsage, token.id, tokens]);
  const usageCount = usage.length;

  const selectUsage = () => {
    if (usageCount === 0) return;
    const ids = Array.from(new Set(usage.map((u) => u.nodeId))) as NodeId[];
    setSelection(ids);
  };

  const handleDelete = () => {
    if (usageCount > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    removeToken(token.id);
    setConfirming(false);
  };

  if (confirming) {
    return (
      <div className="flex h-7 items-center gap-xs rounded-sm border border-amber/40 bg-amber/10 px-xs text-xs">
        <span className="flex-1 text-ink">
          Unlink {usageCount} node{usageCount === 1 ? "" : "s"} & delete?
        </span>
        <button
          type="button"
          onClick={handleDelete}
          className="inline-flex h-5 items-center rounded-xs border border-amber/40 bg-amber/20 px-sm text-amber hover:bg-amber/30"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="inline-flex h-5 items-center rounded-xs px-sm text-ink-faint hover:bg-chrome-2 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex h-7 items-center gap-xs rounded-sm border border-transparent px-2xs",
        "transition-colors hover:border-line/40 hover:bg-raised/40",
      )}
    >
      <span
        draggable
        onDragStart={(e) => {
          onDragStart();
          e.dataTransfer.effectAllowed = "move";
        }}
        title="Drag to reorder"
        aria-hidden="true"
        className={cn(
          "inline-flex size-4 shrink-0 cursor-grab items-center justify-center text-ink-faint",
          "opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing",
        )}
      >
        <GripVertical size={11} />
      </span>
      {token.category === "color" ? (
        <ColorSwatchInput
          value={token.value as string}
          onChange={(v) => updateToken(token.id, { value: v })}
        />
      ) : null}
      <input
        value={nameDraft}
        onChange={(e) => {
          const next = normalizeName(e.target.value);
          setNameDraft(next);
          setNameError(validate(next));
        }}
        onBlur={() => {
          commitName();
          setNameError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "Escape") {
            setNameDraft(token.name);
            setNameError(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
        spellCheck={false}
        placeholder="tokenName"
        aria-label={`${token.name} token name`}
        title={nameError ?? token.category}
        className={cn(
          "h-5 min-w-0 flex-1 rounded-xs border bg-transparent px-xs font-mono text-xs text-ink",
          "outline-none transition-colors hover:bg-chrome-2",
          "focus-visible:border-accent-line focus-visible:bg-chrome-2",
          nameError ? "border-amber" : "border-transparent",
        )}
      />
      {token.category !== "color" && (
        <>
          <span className="shrink-0 text-xs text-ink-faint" aria-hidden="true">
            ·
          </span>
          <input
            type="number"
            value={token.value as number}
            onChange={(e) => updateToken(token.id, { value: Number(e.target.value) })}
            title={`${CATEGORY_LABEL[token.category]} token value`}
            aria-label={`${token.name} ${CATEGORY_LABEL[token.category].toLowerCase()} token value`}
            className={cn(
              "h-5 w-12 shrink-0 rounded-xs border border-line bg-chrome-2 px-xs text-right text-xs tabular-nums text-ink",
              "outline-none transition-colors hover:bg-raised focus-visible:border-accent-line focus-visible:bg-raised",
            )}
          />
        </>
      )}
      {usageCount > 0 ? (
        <button
          type="button"
          onClick={selectUsage}
          title={`Used by ${usageCount} node${usageCount === 1 ? "" : "s"} — click to select`}
          className={cn(
            "inline-flex h-5 min-w-[1.5rem] shrink-0 items-center justify-center rounded-xs bg-raised px-xs text-[10px] tabular-nums text-ink-dim",
            "transition-colors hover:bg-accent-soft hover:text-accent",
          )}
        >
          {usageCount}
        </button>
      ) : (
        // Spacer keeps row alignment consistent across used/unused tokens.
        <span className="inline-block h-5 w-[1.5rem] shrink-0" aria-hidden="true" title="Not used" />
      )}
      <button
        type="button"
        onClick={handleDelete}
        title={usageCount > 0 ? `Delete (${usageCount} uses)` : "Delete token"}
        aria-label="Delete token"
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-xs text-ink-faint",
          "opacity-0 transition-opacity hover:bg-raised hover:text-ink group-hover:opacity-100",
        )}
      >
        <Trash2 size={12} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Matches the swatch styling used by ColorField/TokenColorField. */
function ColorSwatchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const lifecycle = {
    onEditStart: () => {
      const store = useDocumentStore.getState();
      if (!store.interaction) store.beginInteraction();
    },
    onEditEnd: () => useDocumentStore.getState().commitInteraction(),
    onEditCancel: () => useDocumentStore.getState().cancelInteraction(),
  };
  return (
    <span
      className={cn(
        "relative inline-flex size-swatch shrink-0 cursor-pointer overflow-hidden rounded-xs",
        "ring-1 ring-inset ring-line transition-shadow hover:ring-ink-faint",
      )}
    >
      <span className="color-checker absolute inset-0 opacity-40" aria-hidden="true" />
      <span className="absolute inset-0" style={{ background: value }} aria-hidden="true" />
      <ColorPickerPopover
        value={value}
        onChange={onChange}
        onEditStart={lifecycle.onEditStart}
        onEditEnd={lifecycle.onEditEnd}
        onEditCancel={lifecycle.onEditCancel}
        trigger={
          <button
            type="button"
            aria-label="Token value"
            className="absolute inset-0 cursor-pointer"
          />
        }
      />
    </span>
  );
}
