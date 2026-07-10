import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { findNode, type Node, type NodeId } from "@rn-canvas/document";
import { Field, IconButton, Section, Select, TextField, cn } from "./studio-ui";
import { controlClass } from "./studio-ui/controls";
import { flowScreenName, removeFlowEdgeAtIndex, updateFlowEdge } from "./flow-model";
import { useWorkspaceStore, type FlowDefinition } from "./workspace-store";
import type { FlowEdge } from "./repo-contract";

type ScreenOption = { value: NodeId; label: string };

function screenLabel(root: Node, allScreens: readonly Node[]) {
  const index = allScreens.findIndex((screen) => screen.id === root.id);
  return flowScreenName(root, index < 0 ? 0 : index);
}

function conditionSource(flow: FlowDefinition) {
  return flow.entryRootId ?? flow.routes[0];
}

export function FlowInspector({
  flow,
  screens,
  routeScreens,
  availableScreens,
  onSelectScreen,
  onAddRoute,
  onRemoveRoute,
  onMoveRoute,
  onUpdateFlow,
}: {
  flow: FlowDefinition | undefined;
  screens: Node[];
  routeScreens: Node[];
  availableScreens: Node[];
  onSelectScreen: (rootId: NodeId) => void;
  onAddRoute: (rootId: NodeId) => void;
  onRemoveRoute: (rootId: NodeId) => void;
  onMoveRoute: (rootId: NodeId, offset: -1 | 1) => void;
  onUpdateFlow: (flow: FlowDefinition, status: string) => void;
}) {
  const [pendingScreenId, setPendingScreenId] = useState<NodeId | undefined>(
    availableScreens[0]?.id,
  );
  const removeStoredFlowEdge = useWorkspaceStore((s) => s.removeFlowEdge);
  const screenOptions = useMemo<ScreenOption[]>(
    () => routeScreens.map((root) => ({ value: root.id, label: screenLabel(root, screens) })),
    [routeScreens, screens],
  );
  const availableOptions = useMemo<ScreenOption[]>(
    () => availableScreens.map((root) => ({ value: root.id, label: screenLabel(root, screens) })),
    [availableScreens, screens],
  );

  useEffect(() => {
    if (pendingScreenId && availableScreens.some((screen) => screen.id === pendingScreenId)) {
      return;
    }
    setPendingScreenId(availableScreens[0]?.id);
  }, [availableScreens, pendingScreenId]);

  if (!flow) {
    return (
      <div className="flex h-full items-center justify-center p-md text-sm text-ink-faint">
        Select a flow to inspect.
      </div>
    );
  }

  const updateEdges = (edges: FlowEdge[], status: string) => onUpdateFlow({ ...flow, edges }, status);
  const conditionalEdges = flow.edges
    .map((edge, index) => ({ edge, index }))
    .filter((item) => item.edge.kind === "conditional");

  // Anchored wires: "Source · anchor → Target". The anchor id may be an expanded
  // preview id (instanceId::…); the document node is its first segment.
  const wiredEdges = flow.edges
    .filter((edge) => !!edge.from.anchorNodeId)
    .map((edge) => {
      const source = routeScreens.find((screen) => screen.id === edge.from.rootId);
      const target = routeScreens.find((screen) => screen.id === edge.to);
      const anchorDocId = (edge.from.anchorNodeId ?? "").split("::")[0];
      const anchorNode = source ? findNode(source, anchorDocId) : undefined;
      const anchorLabel = anchorNode?.design?.name ?? anchorNode?.type ?? "element";
      const label = `${source ? screenLabel(source, screens) : "?"} · ${anchorLabel} → ${
        target ? screenLabel(target, screens) : "?"
      }`;
      return { edge, label };
    });
  const onRemoveEdge = (edge: FlowEdge) => void removeStoredFlowEdge(flow.id, edge);

  const addCondition = () => {
    const from = conditionSource(flow);
    const to = routeScreens.find((screen) => screen.id !== from)?.id ?? routeScreens[0]?.id;
    if (!from || !to) return;
    updateEdges(
      [
        ...flow.edges,
        {
          from: { rootId: from },
          to,
          kind: "conditional",
          condition: "Condition",
        },
      ],
      "Added flow condition",
    );
  };

  const updateCondition = (index: number, patch: Partial<FlowEdge>) => {
    const routeIds = routeScreens.map((screen) => screen.id);
    updateEdges(
      updateFlowEdge(flow.edges, routeIds, index, patch),
      "Updated flow condition",
    );
  };

  const removeCondition = (index: number) => {
    updateEdges(
      removeFlowEdgeAtIndex(flow.edges, routeScreens.map((screen) => screen.id), index),
      "Removed flow condition",
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto text-sm">
      <Section title="Description">
        <Field label="Summary" stacked>
          <textarea
            value={flow.description ?? ""}
            onChange={(event) =>
              onUpdateFlow({ ...flow, description: event.target.value }, "Updated flow description")
            }
            className={cn(controlClass, "min-h-24 resize-none leading-5 placeholder:text-ink-faint")}
            placeholder="Describe the user journey this flow represents."
          />
        </Field>
      </Section>

      <Section
        title="Screens"
        action={
          <span className="pr-md text-2xs font-semibold text-ink-faint">
            {routeScreens.length}
          </span>
        }
      >
        <div className="flex gap-xs">
          <div className="min-w-0 flex-1">
            <Select
              value={pendingScreenId}
              onChange={setPendingScreenId}
              options={availableOptions}
              placeholder="Add screen"
              disabled={availableOptions.length === 0}
              ariaLabel="Add screen to flow"
            />
          </div>
          <IconButton
            title="Add screen to flow"
            onClick={() => {
              if (pendingScreenId) onAddRoute(pendingScreenId);
              setPendingScreenId(availableScreens.find((screen) => screen.id !== pendingScreenId)?.id);
            }}
            disabled={!pendingScreenId}
          >
            <Plus size={14} aria-hidden="true" />
          </IconButton>
        </div>
        <div className="flex flex-col gap-xs">
          {routeScreens.map((root, index) => (
            <div
              key={root.id}
              className="flex min-h-8 items-center gap-xs rounded-sm bg-chrome-2 px-sm py-xs text-sm text-ink-dim"
            >
              <button
                type="button"
                onClick={() => onSelectScreen(root.id)}
                className="flex min-w-0 flex-1 items-center gap-xs text-left hover:text-ink"
              >
                <span className="w-5 shrink-0 text-2xs tabular-nums text-ink-faint">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{screenLabel(root, screens)}</span>
              </button>
              <IconButton
                title="Move earlier"
                onClick={() => onMoveRoute(root.id, -1)}
                disabled={index === 0}
              >
                <ArrowUp size={13} aria-hidden="true" />
              </IconButton>
              <IconButton
                title="Move later"
                onClick={() => onMoveRoute(root.id, 1)}
                disabled={index === routeScreens.length - 1}
              >
                <ArrowDown size={13} aria-hidden="true" />
              </IconButton>
              <IconButton title="Remove from flow" onClick={() => onRemoveRoute(root.id)}>
                <X size={13} aria-hidden="true" />
              </IconButton>
            </div>
          ))}
          {routeScreens.length === 0 && (
            <p className="m-0 text-xs text-ink-faint">No screens in this flow yet.</p>
          )}
        </div>
      </Section>

      <Section title="Entry">
        <Select
          value={flow.entryRootId}
          onChange={(entryRootId) => onUpdateFlow({ ...flow, entryRootId }, "Updated flow entry")}
          options={screenOptions}
          placeholder="Select entry"
          disabled={screenOptions.length === 0}
          ariaLabel="Entry screen"
        />
      </Section>

      <Section title="Success">
        <Select
          value={flow.successRootId}
          onChange={(successRootId) =>
            onUpdateFlow({ ...flow, successRootId }, "Updated flow success")
          }
          options={screenOptions}
          placeholder="Select success"
          disabled={screenOptions.length === 0}
          ariaLabel="Success screen"
        />
      </Section>

      <Section title="Wires">
        {wiredEdges.length === 0 ? (
          <p className="m-0 text-xs text-ink-faint">
            No wires yet. Drag from a connect handle on a screen to another screen.
          </p>
        ) : (
          <div className="flex flex-col gap-xs">
            {wiredEdges.map(({ edge, label }, index) => (
              <div
                key={`${edge.from.rootId}-${edge.from.anchorNodeId}-${edge.to}-${index}`}
                className="flex items-center gap-xs rounded-sm bg-chrome-2 px-sm py-xs"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-ink-dim" title={label}>
                  {label}
                </span>
                <IconButton title="Remove wire" onClick={() => onRemoveEdge(edge)}>
                  <X size={13} aria-hidden="true" />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Conditions"
        action={
          <div className="pr-md">
            <IconButton
              title="Add condition"
              onClick={addCondition}
              disabled={routeScreens.length < 1}
            >
              <Plus size={14} aria-hidden="true" />
            </IconButton>
          </div>
        }
      >
        <div className="flex flex-col gap-sm">
          {conditionalEdges.map(({ edge, index }) => (
            <div key={`${edge.from.rootId}-${edge.to}-${index}`} className="flex flex-col gap-xs rounded-sm bg-chrome-2 p-xs">
              <TextField
                value={edge.condition ?? ""}
                onChange={(condition) => updateCondition(index, { condition })}
                placeholder="Condition"
              />
              <div className="flex gap-xs">
                <div className="min-w-0 flex-1">
                  <Select
                    value={edge.to}
                    onChange={(to) => updateCondition(index, { to })}
                    options={screenOptions}
                    placeholder="Destination"
                    disabled={screenOptions.length === 0}
                    ariaLabel="Condition destination"
                  />
                </div>
                <IconButton title="Remove condition" onClick={() => removeCondition(index)}>
                  <Trash2 size={13} aria-hidden="true" />
                </IconButton>
              </div>
            </div>
          ))}
          {conditionalEdges.length === 0 && (
            <p className="m-0 text-xs text-ink-faint">No conditional branches yet.</p>
          )}
        </div>
      </Section>
    </div>
  );
}
