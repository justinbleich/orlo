import type { Node, NodeId } from "@rn-canvas/document";

export type FlowDefinitionLike = { id: string };
export type FlowRoutes = Partial<Record<string, NodeId[]>>;

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
