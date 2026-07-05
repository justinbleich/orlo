import type { Node, NodeId } from "@rn-canvas/document";
import type { FlowEdge } from "./repo-contract";

export type FlowDefinitionLike = { id: string };
export type FlowRoutes = Partial<Record<string, NodeId[]>>;
export type FlowRouteDescriptor = { rootId?: NodeId; name?: string; screenKey?: string };
export type FlowGraphLayer = { depth: number; rootIds: NodeId[] };

export function flowScreenName(root: Node, index: number) {
  return root.design?.name ?? `Screen ${index + 1}`;
}

/** Root ids the workspace can currently account for: open documents, loaded
 * repo screens, and screens the repo scan saw via their sidecars. */
export function knownRootIdSet(
  screenRoots: readonly Node[],
  loadedScreens: Iterable<{ rootId: string }>,
  repoContext: { sidecars: Array<{ rootId?: string }> } | null,
): Set<string> {
  const ids = new Set<string>();
  for (const root of screenRoots) ids.add(root.id);
  for (const screen of loadedScreens) ids.add(screen.rootId);
  for (const sidecar of repoContext?.sidecars ?? []) {
    if (sidecar.rootId) ids.add(sidecar.rootId);
  }
  return ids;
}

export function routeStillExists(
  route: { path?: string; rootId?: string },
  repoContext: { screens: Array<{ path: string; sidecarPath?: string }> } | null,
  knownRootIds: ReadonlySet<string>,
): boolean {
  // Until the repo scan lands we can't tell a dead route from an unloaded one.
  if (!repoContext) return true;
  if (route.path) {
    return repoContext.screens.some(
      (screen) => screen.path === route.path || screen.sidecarPath === route.path,
    );
  }
  // Pathless routes are pre-v3 leftovers: alive only if their root is still known.
  return !!route.rootId && knownRootIds.has(route.rootId);
}

export function flowScreenKey(root: Node, index: number) {
  const name = root.design?.name?.trim();
  return name ? `name:${name.toLowerCase()}` : `screen:${index + 1}`;
}

export function resolveFlowRouteIds(
  roots: readonly Node[],
  routes: readonly FlowRouteDescriptor[],
): NodeId[] {
  return resolveFlowRouteMatches(roots, routes).map((match) => match.root.id);
}

export function resolveFlowRouteMatches(
  roots: readonly Node[],
  routes: readonly FlowRouteDescriptor[],
): Array<{ route: FlowRouteDescriptor; root: Node }> {
  const byId = new Map(roots.map((root) => [root.id, root]));
  const byKey = new Map(roots.map((root, index) => [flowScreenKey(root, index), root]));
  const byName = new Map(roots.map((root, index) => [flowScreenName(root, index), root]));
  const used = new Set<NodeId>();
  const resolved: Array<{ route: FlowRouteDescriptor; root: Node }> = [];

  for (const route of routes) {
    const root =
      (route.rootId ? byId.get(route.rootId) : undefined) ??
      (route.screenKey ? byKey.get(route.screenKey) : undefined) ??
      (route.name ? byName.get(route.name) : undefined);
    if (!root || used.has(root.id)) continue;
    used.add(root.id);
    resolved.push({ route, root });
  }
  return resolved;
}

export function resolveFlowRouteIdMap(
  roots: readonly Node[],
  routes: readonly FlowRouteDescriptor[],
): Map<NodeId, NodeId> {
  const resolved = new Map<NodeId, NodeId>();
  for (const { route, root } of resolveFlowRouteMatches(roots, routes)) {
    resolved.set(root.id, root.id);
    if (route.rootId) resolved.set(route.rootId, root.id);
  }
  return resolved;
}

export function inferredFlowScreens(roots: readonly Node[], flow: string): Node[] {
  if (flow === "onboarding") return [...roots];
  const lowered = (root: Node) => (root.design?.name ?? "").toLowerCase();
  const auth = roots.filter((root) =>
    /auth|login|sign|create|verify|welcome/.test(lowered(root)),
  );
  const main = roots.filter((root) => !auth.includes(root));
  if (flow === "auth") return auth.length ? auth : roots.slice(0, 1);
  return main.length ? main : [...roots];
}

export function flowRouteScreens(
  roots: readonly Node[],
  flow: string,
  routeIds?: readonly NodeId[],
): Node[] {
  if (!routeIds) return inferredFlowScreens(roots, flow);
  const byId = new Map(roots.map((root) => [root.id, root]));
  return routeIds.flatMap((id) => {
    const root = byId.get(id);
    return root ? [root] : [];
  });
}

export function flowRouteIds(
  roots: readonly Node[],
  flow: string,
  routeIds?: readonly NodeId[],
): NodeId[] {
  return flowRouteScreens(roots, flow, routeIds).map((root) => root.id);
}

export function flowAvailableScreens(
  roots: readonly Node[],
  flow: string,
  routeIds?: readonly NodeId[],
): Node[] {
  const routed = new Set(flowRouteIds(roots, flow, routeIds));
  return roots.filter((root) => !routed.has(root.id));
}

export function addFlowRoute(
  roots: readonly Node[],
  flow: string,
  routeIds: readonly NodeId[] | undefined,
  rootId: NodeId,
): NodeId[] {
  const current = flowRouteIds(roots, flow, routeIds);
  if (current.includes(rootId) || !roots.some((root) => root.id === rootId)) return current;
  return [...current, rootId];
}

export function removeFlowRoute(
  roots: readonly Node[],
  flow: string,
  routeIds: readonly NodeId[] | undefined,
  rootId: NodeId,
): NodeId[] {
  return flowRouteIds(roots, flow, routeIds).filter((id) => id !== rootId);
}

export function reorderFlowRoute(
  roots: readonly Node[],
  flow: string,
  routeIds: readonly NodeId[] | undefined,
  rootId: NodeId,
  offset: -1 | 1,
): NodeId[] {
  const current = flowRouteIds(roots, flow, routeIds);
  const from = current.indexOf(rootId);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= current.length) return current;
  const next = [...current];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function moveFlowRouteToIndex(
  roots: readonly Node[],
  flow: string,
  routeIds: readonly NodeId[] | undefined,
  rootId: NodeId,
  targetIndex: number,
): NodeId[] {
  const current = flowRouteIds(roots, flow, routeIds);
  const from = current.indexOf(rootId);
  if (from < 0) return current;
  const clamped = Math.max(0, Math.min(targetIndex, current.length - 1));
  if (from === clamped) return current;
  const next = [...current];
  const [moved] = next.splice(from, 1);
  next.splice(clamped, 0, moved);
  return next;
}

export function deriveLinearEdges(routes: readonly NodeId[]): FlowEdge[] {
  const edges: FlowEdge[] = [];
  for (let i = 0; i < routes.length - 1; i += 1) {
    const from = routes[i];
    const to = routes[i + 1];
    if (from && to && from !== to) edges.push({ from: { rootId: from }, to, kind: "primary" });
  }
  return edges;
}

function edgeKey(edge: FlowEdge) {
  return [
    edge.from.rootId,
    edge.from.anchorNodeId ?? "",
    edge.to,
    edge.kind,
    edge.condition ?? "",
  ].join("\u0000");
}

export function pruneFlowEdges(edges: readonly FlowEdge[], routeIds: readonly NodeId[]): FlowEdge[] {
  const routeSet = new Set(routeIds);
  return edges.filter((edge) => routeSet.has(edge.from.rootId) && routeSet.has(edge.to));
}

export function addFlowEdge(
  edges: readonly FlowEdge[],
  routeIds: readonly NodeId[],
  edge: FlowEdge,
): FlowEdge[] {
  if (edge.from.rootId === edge.to) return pruneFlowEdges(edges, routeIds);
  const routeSet = new Set(routeIds);
  if (!routeSet.has(edge.from.rootId) || !routeSet.has(edge.to)) {
    return pruneFlowEdges(edges, routeIds);
  }
  const next = pruneFlowEdges(edges, routeIds);
  const key = edgeKey(edge);
  if (next.some((item) => edgeKey(item) === key)) return next;
  return [...next, edge];
}

export function removeFlowEdge(
  edges: readonly FlowEdge[],
  routeIds: readonly NodeId[],
  match: Partial<FlowEdge> & { from?: Partial<FlowEdge["from"]>; to?: NodeId },
): FlowEdge[] {
  return pruneFlowEdges(edges, routeIds).filter((edge) => {
    if (match.from?.rootId && edge.from.rootId !== match.from.rootId) return true;
    if (match.from?.anchorNodeId && edge.from.anchorNodeId !== match.from.anchorNodeId) return true;
    if (match.to && edge.to !== match.to) return true;
    if (match.kind && edge.kind !== match.kind) return true;
    if (match.condition && edge.condition !== match.condition) return true;
    return false;
  });
}

export function updateFlowEdge(
  edges: readonly FlowEdge[],
  routeIds: readonly NodeId[],
  index: number,
  patch: Partial<FlowEdge> & { from?: Partial<FlowEdge["from"]> },
): FlowEdge[] {
  const current = pruneFlowEdges(edges, routeIds);
  const existing = current[index];
  if (!existing) return current;
  const updated: FlowEdge = {
    ...existing,
    ...patch,
    from: { ...existing.from, ...(patch.from ?? {}) },
  };
  const without = current.filter((_, itemIndex) => itemIndex !== index);
  return addFlowEdge(without, routeIds, updated);
}

export function flowGraphLayers(
  entryRootId: NodeId | undefined,
  edges: readonly FlowEdge[],
  routeIds: readonly NodeId[] = [],
): FlowGraphLayer[] {
  const nodes = new Set<NodeId>(routeIds);
  for (const edge of edges) {
    nodes.add(edge.from.rootId);
    nodes.add(edge.to);
  }
  if (nodes.size === 0) return [];
  const entry = entryRootId && nodes.has(entryRootId) ? entryRootId : [...nodes][0];
  const adjacency = new Map<NodeId, NodeId[]>();
  for (const edge of edges) {
    if (!nodes.has(edge.from.rootId) || !nodes.has(edge.to)) continue;
    const next = adjacency.get(edge.from.rootId) ?? [];
    if (!next.includes(edge.to)) next.push(edge.to);
    adjacency.set(edge.from.rootId, next);
  }
  const depthByRoot = new Map<NodeId, number>([[entry, 0]]);
  const queue = [entry];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const rootId = queue[cursor];
    const nextDepth = (depthByRoot.get(rootId) ?? 0) + 1;
    for (const target of adjacency.get(rootId) ?? []) {
      if (depthByRoot.has(target)) continue;
      depthByRoot.set(target, nextDepth);
      queue.push(target);
    }
  }
  for (const rootId of nodes) {
    if (!depthByRoot.has(rootId)) depthByRoot.set(rootId, 0);
  }
  const layers = new Map<number, NodeId[]>();
  const routeOrder = new Map(routeIds.map((rootId, index) => [rootId, index]));
  for (const [rootId, depth] of depthByRoot) {
    layers.set(depth, [...(layers.get(depth) ?? []), rootId]);
  }
  return [...layers.entries()]
    .sort(([a], [b]) => a - b)
    .map(([depth, rootIds]) => ({
      depth,
      rootIds: rootIds.sort(
        (a, b) => (routeOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (routeOrder.get(b) ?? Number.MAX_SAFE_INTEGER),
      ),
    }));
}
