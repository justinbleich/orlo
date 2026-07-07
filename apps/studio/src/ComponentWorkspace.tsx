import { useEffect, useMemo, useRef, useState } from "react";
import {
  resolveVariant,
  type ComponentDefinition,
  type ComponentRegistry,
  type Node,
  type NodeId,
} from "@rn-canvas/document";
import { Check, X } from "lucide-react";
import { Tabs } from "./shell";
import { Button, TextField, cn } from "./studio-ui";
import { color, radius, space, text } from "./studio-theme";
import { useStudioStore } from "./studio-store";
import {
  MAX_VARIANT_PREVIEWS,
  comboHasOverrides,
  variantPreviewCombinations,
  variantPreviewKey,
  variantPreviewLabel,
} from "./variant-workspace";

export type ComponentWorkspaceTab = "Canvas" | "Usage" | "Docs";

function editedAgoLabel(editedAt: number): string {
  const minutes = Math.floor((Date.now() - editedAt) / 60_000);
  if (minutes < 1) return "edited just now";
  if (minutes < 60) return `edited ${minutes}m ago`;
  return `edited ${Math.floor(minutes / 60)}h ago`;
}

export function ComponentWorkspace({
  definition,
  roots,
  components,
  usage,
  activeTab,
  onTabChange,
  onRename,
  onSelectVariant,
  onSelectUsage,
  onCancel,
  onDone,
  children,
}: {
  definition: ComponentDefinition;
  roots: Record<NodeId, Node>;
  components: ComponentRegistry;
  usage: { rootId: NodeId; nodeId: NodeId }[];
  activeTab: ComponentWorkspaceTab;
  onTabChange: (tab: ComponentWorkspaceTab) => void;
  onRename: (name: string) => boolean;
  onSelectVariant: (values: Record<string, string>) => void;
  onSelectUsage: (rootId: NodeId, nodeId: NodeId) => void;
  onCancel: () => void;
  onDone: () => void;
  children: React.ReactNode;
}) {
  const activeVariant = useStudioStore((s) => s.activeVariant);
  const combos = useMemo(() => variantPreviewCombinations(definition), [definition]);
  const axes = (definition.variants ?? []).filter((axis) => axis.values.length > 0);
  const visibleCombos = combos.slice(0, MAX_VARIANT_PREVIEWS);
  const hiddenCount = Math.max(0, combos.length - visibleCombos.length);
  const activeKey = variantPreviewKey(definition, resolveVariant(definition, activeVariant));
  const baseKey = variantPreviewKey(
    definition,
    Object.fromEntries(axes.map((axis) => [axis.name, axis.values[0]])),
  );
  const [nameDraft, setNameDraft] = useState(definition.name);
  const skipNextNameCommitRef = useRef(false);

  useEffect(() => setNameDraft(definition.name), [definition.name]);

  // "edited Nm ago": mark when this component's definition identity changes —
  // skipping mount and component switches, so opening the workspace alone
  // doesn't count as an edit.
  const markComponentEdited = useStudioStore((s) => s.markComponentEdited);
  const editedAt = useStudioStore((s) => s.componentEditedAt[definition.id]);
  const prevDefinitionRef = useRef<ComponentDefinition | null>(null);
  useEffect(() => {
    const prev = prevDefinitionRef.current;
    prevDefinitionRef.current = definition;
    if (prev && prev.id === definition.id && prev !== definition) {
      markComponentEdited(definition.id);
    }
  }, [definition, markComponentEdited]);
  // Re-render on a coarse tick so the relative label stays current.
  const [, setEditedTick] = useState(0);
  useEffect(() => {
    if (!editedAt) return;
    const interval = setInterval(() => setEditedTick((tick) => tick + 1), 30_000);
    return () => clearInterval(interval);
  }, [editedAt]);

  const resetNameDraft = () => setNameDraft(definition.name);
  const commitNameDraft = (raw = nameDraft) => {
    if (skipNextNameCommitRef.current) {
      skipNextNameCommitRef.current = false;
      return;
    }
    const next = raw.trim();
    if (!next || next === definition.name) {
      resetNameDraft();
      return;
    }
    if (onRename(next)) setNameDraft(next);
    else resetNameDraft();
  };

  const tabLabels: ComponentWorkspaceTab[] = ["Canvas", "Usage", "Docs"];
  const tabs = tabLabels.map((tab) => (tab === "Usage" ? `Usage (${usage.length})` : tab));
  const activeTabLabel = activeTab === "Usage" ? `Usage (${usage.length})` : activeTab;
  const selectTabLabel = (label: string) => {
    onTabChange(label.startsWith("Usage") ? "Usage" : (label as ComponentWorkspaceTab));
  };

  return (
    <div className="studio-chrome flex h-full min-w-0 bg-canvas">
      <aside className="flex w-44 shrink-0 flex-col border-r border-line bg-chrome">
        <div className="border-b border-line-soft px-md py-sm">
          <div className="eyebrow">Variants</div>
          <div className="mt-1 text-xs text-ink-faint">{combos.length} states</div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-xs">
          {axes.length === 0 ? (
            <div className="px-sm py-md text-xs text-ink-faint">Default only</div>
          ) : (
            visibleCombos.map((values) => {
              const key = variantPreviewKey(definition, values);
              const active = key === activeKey;
              const hasOverrides = comboHasOverrides(definition, values);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectVariant(values)}
                  className={cn(
                    "flex h-8 w-full items-center gap-xs rounded-sm px-sm text-left text-xs transition-colors",
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-ink-dim hover:bg-raised hover:text-ink",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      hasOverrides ? "bg-accent" : "bg-transparent ring-1 ring-line",
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-1 items-center gap-xs">
                    <span className="min-w-0 truncate">
                      {variantPreviewLabel(definition, values)}
                    </span>
                    {key === baseKey && (
                      <span className="shrink-0 rounded-xs bg-raised px-2xs text-2xs text-ink-faint">
                        default
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
          {hiddenCount > 0 && (
            <div className="px-sm py-xs text-xs text-ink-faint">+{hiddenCount} more</div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-md border-b border-line bg-chrome px-lg py-sm">
          <div className="flex min-w-0 flex-col">
            <div className="text-xs text-ink-faint">Components /</div>
            <TextField
              aria-label="Component name"
              value={nameDraft}
              onChange={setNameDraft}
              onBlur={(event) => commitNameDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitNameDraft(event.currentTarget.value);
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  skipNextNameCommitRef.current = true;
                  resetNameDraft();
                  event.currentTarget.blur();
                }
              }}
              className="h-7 max-w-72 border-transparent bg-transparent px-2xs text-sm font-semibold text-ink shadow-none hover:border-line hover:bg-raised focus-visible:border-accent-line focus-visible:bg-chrome-2"
            />
          </div>
          {editedAt !== undefined && (
            <div className="rounded-pill bg-raised px-sm py-1 text-xs text-ink-dim">
              {editedAgoLabel(editedAt)}
            </div>
          )}
          <div className="ml-auto flex items-center gap-xs">
            <Button variant="ghost" onClick={onCancel}>
              <X size={14} aria-hidden="true" /> Cancel
            </Button>
            <Button variant="primary" onClick={onDone}>
              <Check size={14} aria-hidden="true" /> Done
            </Button>
          </div>
        </div>
        <div className="border-b border-line-soft bg-chrome px-lg">
          <Tabs
            tabs={tabs}
            active={activeTabLabel}
            onSelect={selectTabLabel}
            variant="underline"
          />
        </div>
        <div className="relative min-h-0 flex-1">
          {activeTab === "Canvas" ? (
            children
          ) : activeTab === "Usage" ? (
            <UsageList
              usage={usage}
              roots={roots}
              components={components}
              onSelectUsage={onSelectUsage}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ink-faint">
              Docs coming soon.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UsageList({
  usage,
  roots,
  components,
  onSelectUsage,
}: {
  usage: { rootId: NodeId; nodeId: NodeId }[];
  roots: Record<NodeId, Node>;
  components: ComponentRegistry;
  onSelectUsage: (rootId: NodeId, nodeId: NodeId) => void;
}) {
  const grouped = new Map<NodeId, { label: string; count: number; firstNodeId: NodeId; kind: string }>();
  for (const item of usage) {
    const root = roots[item.rootId];
    const component = components[item.rootId];
    const label = root?.design?.name ?? component?.name ?? item.rootId;
    const current = grouped.get(item.rootId);
    grouped.set(item.rootId, {
      label,
      count: (current?.count ?? 0) + 1,
      firstNodeId: current?.firstNodeId ?? item.nodeId,
      kind: component ? "Component" : "Screen",
    });
  }
  const rows = [...grouped.entries()];
  return (
    <div className="h-full overflow-auto p-lg">
      {rows.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <div className="rounded-sm border border-dashed border-line bg-chrome px-lg py-md text-sm text-ink-faint">
            No placed instances.
          </div>
        </div>
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-sm">
          <div className="flex items-center justify-between gap-md border-b border-line-soft pb-sm">
            <div>
              <div className="text-sm font-semibold text-ink">Placed instances</div>
              <div className="text-xs text-ink-faint">
                {usage.length} total across {rows.length} {rows.length === 1 ? "screen" : "screens"}
              </div>
            </div>
          </div>
          {rows.map(([rootId, row], index) => (
            <button
              key={rootId}
              type="button"
              onClick={() => onSelectUsage(rootId, row.firstNodeId)}
              className={cn(
                "flex min-h-12 items-center gap-sm rounded-sm border border-line bg-chrome px-md text-left text-sm transition-colors",
                "hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line",
                index === 0 && "border-accent-line/60",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{row.label}</div>
                <div className="text-xs text-ink-faint">{row.kind} root {rootId}</div>
              </div>
              <span
                style={{
                  borderRadius: radius.pill,
                  background: color.raised,
                  color: color.inkDim,
                  padding: `2px ${space.sm}`,
                  fontSize: text.xs,
                }}
              >
                x{row.count}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
