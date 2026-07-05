/**
 * Workspace state — repo connection, git status, codegen/sync pipeline, and the
 * status line. A Zustand store (not App state) so panels subscribe to exactly
 * the slices they render: a status-line update or a git poll no longer
 * re-renders the whole shell, and CodePanel needs no prop drilling.
 *
 * Non-reactive pipeline latches (in-flight codegen, debounce timers, load
 * suppression flags) live at module scope: they change many times per second
 * during edits and must never cause renders.
 */
import { create } from "zustand";
import {
  useDocumentStore,
  type ComponentRegistry,
  type Node,
  type NodeId,
  type TokenRegistry,
} from "@rn-canvas/document";
import {
  codeArtifacts,
  type CodeArtifact,
  type CodegenResult,
  type GitStatus,
} from "./code-artifacts";
import { pruneCanvasManifest } from "./canvas-arrange";
import {
  bindLoadedRepoScreen,
  displayScreenName,
  type RepoPanelContext,
} from "./repo-project-model";
import { createScreenFrame, nextScreenName } from "./document-actions";
import {
  addFlowEdge,
  deriveLinearEdges,
  flowRouteScreens,
  resolveFlowRouteIdMap,
  flowScreenKey,
  flowScreenName,
  knownRootIdSet,
  resolveFlowRouteIds,
  routeStillExists,
} from "./flow-model";
import type { FlowEdge, FlowManifest, FlowManifestEdge, FlowManifestRoute } from "./repo-contract";

export type FlowDefinition = {
  id: string;
  label: string;
  description?: string;
  entryRootId?: NodeId;
  successRootId?: NodeId;
  routes: NodeId[];
  edges: FlowEdge[];
  manifestRoutes?: FlowManifestRoute[];
  manifestEdges?: FlowManifestEdge[];
  manifestEntryPath?: string;
  manifestSuccessPath?: string;
};

export type FlowPositions = Record<string, Record<string, { x: number; y: number }>>;

export const DEFAULT_FLOWS: FlowDefinition[] = [
  {
    id: "onboarding",
    label: "Onboarding Flow",
    description: "Default stack order for first-run screens.",
    routes: [],
    edges: [],
  },
  {
    id: "main",
    label: "Main App Flow",
    description: "Primary app route order from the current screen tree.",
    routes: [],
    edges: [],
  },
  {
    id: "auth",
    label: "Auth Flow",
    description: "Authentication screens inferred from screen names when present.",
    routes: [],
    edges: [],
  },
];

export type SyncState =
  | { status: "idle" }
  | { status: "scheduled" }
  | { status: "syncing" }
  | { status: "synced"; path: string }
  | { status: "error"; message: string };

export type ActiveRepoScreen = {
  path: string;
  sidecarPath?: string;
  rootId: NodeId;
  /** The screen's component name, kept so background roots sync under their own
   *  name (the editable name field only binds to the active screen). */
  screenName?: string;
};
export type LoadedRepoScreens = Record<string, ActiveRepoScreen>;
export type RepoScreenTarget = { path: string; sidecarPath?: string; rnCanvas?: boolean };

type OpenDocumentResult = {
  version: 1;
  screenName: string;
  root: Node;
  components?: ComponentRegistry;
  tokens?: TokenRegistry;
  repoPath?: string;
  targetPath: string;
  sidecarPath: string;
};

type ImportSourceResult = {
  screenName: string;
  root: Node;
  repoPath?: string;
  sourcePath: string;
  sidecarPath: string;
};

type FlowApplyResult = CodegenResult & {
  wrote?: boolean;
};

// --- Non-reactive pipeline latches --------------------------------------------

/** Cross-cutting suppression flags shared with App-side canvas glue (e.g. the
 *  onMount seed load must not be echoed to disk). Mutating these never renders. */
export const workspaceFlags = {
  /** A repo-managed document is open; auto-sync may write files. */
  managedDocument: false,
  /** Next token-registry change is a load, not an edit — don't write theme.ts. */
  skipTokenWrite: false,
  /** Next document change is a load, not an edit — don't schedule a code sync. */
  skipCodeSync: false,
};

let codegenInFlight = false;
let rerunRequested = false;
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
/** Last canvas-manifest payload we saved or loaded (idempotent writer). */
let canvasSaved = "";
let canvasSaveTimer: ReturnType<typeof setTimeout> | null = null;
/** The root the next codegen targets — the last focused screen. */
let syncRootHint: NodeId | null = null;
/** Roots edited since the last flush. A token/component change dirties every
 *  screen root (token reapply touches all trees), so a color-token edit syncs
 *  every affected generated file, not just the focused one. */
const dirtyRoots = new Set<NodeId>();
let nextToastId = 1;

function defaultFlowsById(): Record<string, FlowDefinition> {
  return Object.fromEntries(DEFAULT_FLOWS.map((flow) => [flow.id, { ...flow }]));
}

function flowsFromState(state: Pick<WorkspaceState, "flowsById" | "flowOrder">): FlowDefinition[] {
  return state.flowOrder.flatMap((id) => {
    const flow = state.flowsById[id];
    return flow ? [flow] : [];
  });
}

function screenRootsFromDocument(): Node[] {
  const state = useDocumentStore.getState();
  return Object.values(state.roots).filter((root) => root.id !== state.editingComponentId);
}

function screenPathMap(loadedRepoScreens: LoadedRepoScreens) {
  const byRoot = new Map<NodeId, ActiveRepoScreen>();
  const byPath = new Map<string, ActiveRepoScreen>();
  for (const screen of Object.values(loadedRepoScreens)) {
    byRoot.set(screen.rootId, screen);
    byPath.set(screen.path, screen);
    if (screen.sidecarPath) byPath.set(screen.sidecarPath, screen);
  }
  return { byRoot, byPath };
}

function resolveManifestRouteIds(
  screenRoots: readonly Node[],
  routes: readonly FlowManifestRoute[],
  loadedRepoScreens: LoadedRepoScreens,
) {
  const { byPath } = screenPathMap(loadedRepoScreens);
  const pathRoutes = routes.map((route) => ({
    ...route,
    rootId: route.path ? (byPath.get(route.path)?.rootId ?? route.rootId) : route.rootId,
  }));
  return resolveFlowRouteIds(screenRoots, pathRoutes);
}

function resolveManifestRouteIdMap(
  screenRoots: readonly Node[],
  routes: readonly FlowManifestRoute[],
  loadedRepoScreens: LoadedRepoScreens,
) {
  const { byPath } = screenPathMap(loadedRepoScreens);
  const pathRoutes = routes.map((route) => ({
    ...route,
    rootId: route.path ? (byPath.get(route.path)?.rootId ?? route.rootId) : route.rootId,
  }));
  const routeIdMap = resolveFlowRouteIdMap(screenRoots, pathRoutes);
  for (const route of routes) {
    const loaded = route.path ? byPath.get(route.path) : undefined;
    if (!loaded) continue;
    routeIdMap.set(loaded.rootId, loaded.rootId);
    if (route.rootId) routeIdMap.set(route.rootId, loaded.rootId);
  }
  return routeIdMap;
}

function manifestFlowToDefinition(
  flow: FlowManifest["flows"][number],
  screenRoots: readonly Node[],
  loadedRepoScreens: LoadedRepoScreens,
  repoContext: RepoPanelContext | null,
): FlowDefinition {
  const knownRootIds = knownRootIdSet(screenRoots, Object.values(loadedRepoScreens), repoContext);
  const manifestRoutes = flow.routes.filter((route) =>
    routeStillExists(route, repoContext, knownRootIds),
  );
  const routes = resolveManifestRouteIds(screenRoots, manifestRoutes, loadedRepoScreens);
  const routeIdMap = resolveManifestRouteIdMap(screenRoots, manifestRoutes, loadedRepoScreens);
  const routeSet = new Set(routes);
  const normalizeRootId = (rootId?: NodeId, path?: string) => {
    const loaded = path ? screenPathMap(loadedRepoScreens).byPath.get(path)?.rootId : undefined;
    return loaded ?? (rootId ? routeIdMap.get(rootId) ?? rootId : undefined);
  };
  const entryRootId =
    routes.find((rootId) => rootId === normalizeRootId(flow.entryRootId, flow.entryPath)) ??
    (flow.entryName
      ? resolveFlowRouteIds(screenRoots, [{ rootId: flow.entryRootId, name: flow.entryName }])[0]
      : undefined);
  const successRootId = normalizeRootId(flow.successRootId, flow.successPath);
  return {
    id: flow.id,
    label: flow.label,
    description: flow.description,
    entryRootId,
    successRootId:
      successRootId && routeSet.has(successRootId) ? successRootId : undefined,
    routes,
    edges: flow.edges.flatMap((edge) => {
      const from = normalizeRootId(edge.from.rootId, edge.from.path);
      const to = normalizeRootId(edge.to, edge.toPath);
      if (!from || !to || !routeSet.has(from) || !routeSet.has(to)) return [];
      return [{ ...edge, from: { ...edge.from, rootId: from }, to }];
    }),
    manifestRoutes,
    manifestEdges: flow.edges,
    manifestEntryPath: flow.entryPath,
    manifestSuccessPath: flow.successPath,
  };
}

function flowDefinitionsToManifest(
  flows: readonly FlowDefinition[],
  screenRoots: readonly Node[],
  loadedRepoScreens: LoadedRepoScreens,
  repoContext: RepoPanelContext | null,
): FlowManifest {
  const { byRoot } = screenPathMap(loadedRepoScreens);
  const knownRootIds = knownRootIdSet(screenRoots, Object.values(loadedRepoScreens), repoContext);
  return {
    version: 3,
    flows: flows.map((flow) => {
      const routeScreens = flowRouteScreens(screenRoots, flow.id, flow.routes);
      const routeIds = routeScreens.map((root) => root.id);
      const routeSet = new Set(routeIds);
      const entry =
        (flow.entryRootId
          ? routeScreens.find((root) => root.id === flow.entryRootId)
          : undefined) ?? routeScreens[0];
      const success = flow.successRootId
        ? routeScreens.find((root) => root.id === flow.successRootId)
        : undefined;
      const liveRoutes = routeScreens.map((root, index) => {
        const screen = byRoot.get(root.id);
        return {
          rootId: root.id,
          path: screen?.path,
          name: screen?.screenName ?? flowScreenName(root, index),
          screenKey: flowScreenKey(root, index),
        };
      });
      const liveRouteKeys = new Set(
        liveRoutes.flatMap((route) => [
          `root:${route.rootId}`,
          ...(route.path ? [`path:${route.path}`] : []),
        ]),
      );
      const preservedRoutes = (flow.manifestRoutes ?? []).filter((route) => {
        if (!routeStillExists(route, repoContext, knownRootIds)) return false;
        if (route.rootId && liveRouteKeys.has(`root:${route.rootId}`)) return false;
        if (route.path && liveRouteKeys.has(`path:${route.path}`)) return false;
        return true;
      });
      const routes = [...liveRoutes, ...preservedRoutes];
      const pathForRoot = (rootId?: NodeId) => (rootId ? byRoot.get(rootId)?.path : undefined);
      const liveEdges =
        flow.edges.length > 0
          ? flow.edges
              .filter((edge) => routeSet.has(edge.from.rootId) && routeSet.has(edge.to))
              .map((edge) => ({
                ...edge,
                from: { ...edge.from, path: pathForRoot(edge.from.rootId) },
                toPath: pathForRoot(edge.to),
              }))
          : deriveLinearEdges(routeIds).map((edge) => ({
              ...edge,
              from: { ...edge.from, path: pathForRoot(edge.from.rootId) },
              toPath: pathForRoot(edge.to),
            }));
      const liveEdgeKeys = new Set(
        liveEdges.flatMap((edge) => [
          `${edge.from.rootId ?? ""}->${edge.to ?? ""}:${edge.kind}:${edge.from.anchorNodeId ?? ""}`,
          edge.from.path && edge.toPath
            ? `${edge.from.path}->${edge.toPath}:${edge.kind}:${edge.from.anchorNodeId ?? ""}`
            : "",
        ]),
      );
      const preservedEdges = (flow.manifestEdges ?? []).filter((edge) => {
        const rootKey = `${edge.from.rootId ?? ""}->${edge.to ?? ""}:${edge.kind}:${edge.from.anchorNodeId ?? ""}`;
        const pathKey =
          edge.from.path && edge.toPath
            ? `${edge.from.path}->${edge.toPath}:${edge.kind}:${edge.from.anchorNodeId ?? ""}`
            : "";
        return !liveEdgeKeys.has(rootKey) && !liveEdgeKeys.has(pathKey);
      });
      return {
        id: flow.id,
        label: flow.label,
        description: flow.description,
        entryRootId: entry?.id,
        entryPath: entry ? pathForRoot(entry.id) : flow.manifestEntryPath,
        entryName: entry?.design?.name,
        successRootId: success?.id,
        successPath: success ? pathForRoot(success.id) : flow.manifestSuccessPath,
        routes,
        edges: [...liveEdges, ...preservedEdges],
      };
    }),
  };
}

function canvasPayload(
  positions: Record<NodeId, { x: number; y: number }>,
  flowPositions: FlowPositions,
) {
  return JSON.stringify({ positions, flowPositions });
}

function slugPathSegment(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "screen";
}

function screenTargetDirectory(context: RepoPanelContext | null) {
  const paths = [
    ...(context?.screens.map((screen) => screen.path) ?? []),
    ...(context?.entrypoints ?? []),
  ];
  const hasExpoRouter = !!context?.frameworks.some((framework) => framework.id === "expo-router");
  if (hasExpoRouter || paths.some((path) => path.startsWith("app/") || path.startsWith("src/app/"))) {
    return paths.some((path) => path.startsWith("src/app/")) ? "src/app" : "app";
  }
  const hasReactNavigation = !!context?.frameworks.some((framework) => framework.id === "react-navigation");
  const screenDirs = ["src/screens", "screens", "src/routes", "routes"];
  const existing = screenDirs.find((dir) => paths.some((path) => path.startsWith(`${dir}/`)));
  if (existing) return existing;
  if (hasReactNavigation) return "src/screens";
  return "generated";
}

function nextScreenTargetPath(context: RepoPanelContext | null, screenName: string) {
  const dir = screenTargetDirectory(context);
  const base = slugPathSegment(screenName);
  const taken = new Set<string>();
  for (const screen of context?.screens ?? []) taken.add(screen.path);
  for (const sidecar of context?.sidecars ?? []) {
    if (sidecar.targetPath) taken.add(sidecar.targetPath);
  }
  for (let index = 1; ; index += 1) {
    const slug = index === 1 ? base : `${base}-${index}`;
    const path = `${dir}/${slug}.tsx`;
    if (!taken.has(path)) return path;
  }
}

function saveCanvasManifestLater() {
  if (canvasSaveTimer) clearTimeout(canvasSaveTimer);
  canvasSaveTimer = setTimeout(() => {
    const documentState = useDocumentStore.getState();
    const workspaceState = useWorkspaceStore.getState();
    const knownRootIds = new Set<NodeId>(Object.keys(documentState.roots));
    for (const sidecar of workspaceState.repoContext?.sidecars ?? []) {
      if (sidecar.rootId) knownRootIds.add(sidecar.rootId);
    }
    const knownFlowIds = new Set<string>(Object.keys(workspaceState.flowsById));
    const manifest = pruneCanvasManifest(
      documentState.framePositions,
      workspaceState.flowPositions,
      knownRootIds,
      knownFlowIds,
    );
    const payload = canvasPayload(manifest.positions, manifest.flowPositions);
    if (payload === canvasSaved) return;
    canvasSaved = payload;
    void fetch("/api/canvas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manifest: { version: 1, ...manifest } }),
    }).catch(() => {});
  }, 500);
}

export function setSyncRootHint(rootId: NodeId | null) {
  syncRootHint = rootId;
}

/** Canvas-side effects the store can't own (frame focus, tldraw history). */
let studioHooks: { onRepoDocumentOpened(rootId: NodeId): void } = {
  onRepoDocumentOpened: () => {},
};

export function registerStudioHooks(hooks: typeof studioHooks) {
  studioHooks = hooks;
}

function syncRoot(): Node | null {
  const state = useDocumentStore.getState();
  const remembered = syncRootHint ? state.roots[syncRootHint] : null;
  if (remembered && remembered.id !== state.editingComponentId) return remembered;
  return Object.values(state.roots).find((root) => root.id !== state.editingComponentId) ?? null;
}

interface WorkspaceState {
  status: string;
  gitStatus: GitStatus;
  syncState: SyncState;
  screenName: string;
  targetPath: string;
  sidecarPath: string;
  codegenResult: CodegenResult | null;
  codegenBusy: boolean;
  codegenError: string | null;
  activeArtifactId: string;
  /** Committed (HEAD) content per output path — the diff baseline. Auto-sync
   *  writes live to disk, so the meaningful diff is against the last commit. */
  headByPath: Record<string, string>;
  branchInfo: { current: string; branches: string[] };
  repoPath: string;
  repoDraft: string;
  repoError: string | null;
  repoBusy: boolean;
  repoContext: RepoPanelContext | null;
  activeRepoScreen: ActiveRepoScreen | null;
  loadedRepoScreens: LoadedRepoScreens;
  flowsById: Record<string, FlowDefinition>;
  flowOrder: string[];
  flowPositions: FlowPositions;
  flowWireMode: boolean;

  /** Persistent error notices (sync/repo/git failures). Transient confirmations
   *  stay in the status strip; errors stack here until dismissed. */
  toasts: Array<{ id: number; message: string }>;
  pushToast(message: string): void;
  dismissToast(id: number): void;

  setStatus(status: string): void;
  setRepoDraft(value: string): void;
  setActiveArtifactId(id: string): void;
  setActiveRepoScreen(screen: ActiveRepoScreen | null): void;
  /** User-facing path edits reschedule auto-sync; programmatic loads set state
   *  directly and don't. */
  setScreenName(value: string): void;
  setTargetPath(value: string): void;
  setSidecarPath(value: string): void;

  refreshGitStatus(): Promise<void>;
  refreshBranches(): Promise<void>;
  refreshHeads(list: CodeArtifact[]): Promise<void>;
  loadRepo(): Promise<void>;
  loadRepoContext(): Promise<void>;
  loadCanvasManifest(): Promise<void>;
  createRepoScreen(): Promise<Node | null>;
  renameRepoScreen(rootId: NodeId, name: string): void;
  deleteRepoScreen(screen: RepoScreenTarget): Promise<void>;
  applyFlowManifest(body: FlowManifest): void;
  reconcileFlowsWithRepo(): void;
  loadFlowManifest(): Promise<void>;
  persistFlowManifest(
    nextFlows?: FlowDefinition[],
    screenRootsOverride?: Node[],
  ): Promise<void>;
  setFlowEntryRoot(flowId: string, rootId: NodeId): Promise<void>;
  updateFlowRoutes(flowId: string, routeIds: NodeId[], screenRoots?: Node[]): Promise<void>;
  addFlowEdge(flowId: string, edge: FlowEdge): Promise<void>;
  hydrateRepoFlows(flows: FlowDefinition[]): void;
  upsertFlow(flow: FlowDefinition): Promise<void>;
  removeFlow(flowId: string): Promise<void>;
  setFlowPosition(flowId: string, rootId: NodeId, x: number, y: number): void;
  setFlowWireMode(enabled: boolean): void;
  seedFlowPositions(flowPositions: FlowPositions): void;
  requestCodegen(
    mode: "preview" | "sync",
    source?: "manual" | "auto",
  ): Promise<CodegenResult | null>;
  scheduleAutoSync(): void;
  openSidecar(path?: string, mode?: "replace" | "merge"): Promise<void>;
  importSource(path?: string, mode?: "replace" | "merge"): Promise<void>;
  connectRepo(): Promise<void>;
  selectRepoFolder(): Promise<void>;
  connectDemoRepo(): Promise<void>;
  switchBranch(branch: string, create?: boolean): Promise<void>;
  commitChanges(message: string): Promise<void>;
  openPullRequest(): Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /** Store a codegen result and keep dependents coherent: the artifact tab must
   *  exist, and the HEAD diff baseline follows the artifact list. */
  const applyCodegenResult = (result: CodegenResult | null) => {
    const artifacts = codeArtifacts(result);
    set((state) => ({
      codegenResult: result,
      activeArtifactId: artifacts.some((a) => a.id === state.activeArtifactId)
        ? state.activeArtifactId
        : artifacts[0]?.id ?? "screen",
    }));
    void get().refreshHeads(artifacts);
  };

  const postCodegen = async (
    mode: "preview" | "sync",
    payload: { root: Node; screenName: string; targetPath: string; ifAbsent?: boolean },
  ): Promise<CodegenResult> => {
    const state = useDocumentStore.getState();
    const res = await fetch(`/api/codegen/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        components: state.components,
        tokens: state.tokens,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body as CodegenResult;
  };

  /**
   * Write every dirty root that has a sync target, sequentially. The focused
   * screen uses the live editable name/path fields; background repo screens use
   * the metadata captured when they were opened; canvas-only background screens
   * are skipped (there is no file to write until they're focused and synced).
   */
  const flushSync = async (source: "manual" | "auto"): Promise<CodegenResult | null> => {
    if (source === "auto" && !workspaceFlags.managedDocument) {
      set({ syncState: { status: "idle" } });
      return null;
    }
    if (codegenInFlight) {
      if (source === "auto") rerunRequested = true;
      return null;
    }
    const docState = useDocumentStore.getState();
    const displayRootId = get().activeRepoScreen?.rootId ?? syncRoot()?.id ?? null;
    const metaByRoot = new Map<NodeId, { screenName: string; targetPath: string }>();
    for (const screen of Object.values(get().loadedRepoScreens)) {
      if (screen.screenName) {
        metaByRoot.set(screen.rootId, {
          screenName: screen.screenName,
          targetPath: screen.path,
        });
      }
    }
    const targets: { root: Node; screenName: string; targetPath: string }[] = [];
    for (const rootId of [...dirtyRoots]) {
      const root = docState.roots[rootId];
      if (!root || rootId === docState.editingComponentId) {
        dirtyRoots.delete(rootId);
        continue;
      }
      // The editable top-level name/path fields describe the *active* screen
      // only. For every other root the per-screen binding is authoritative —
      // after a delete the top-level fields can point at a file that no longer
      // exists, and syncing another root through them would resurrect it.
      const meta = metaByRoot.get(rootId);
      if (rootId === displayRootId && get().activeRepoScreen?.rootId === rootId) {
        targets.push({ root, screenName: get().screenName, targetPath: get().targetPath });
      } else if (meta) {
        targets.push({ root, ...meta });
      } else if (rootId === displayRootId) {
        targets.push({ root, screenName: get().screenName, targetPath: get().targetPath });
      } else {
        dirtyRoots.delete(rootId);
      }
    }
    if (targets.length === 0) {
      if (source === "manual") {
        const message = "Select a screen before syncing.";
        set({ codegenError: message, status: message, syncState: { status: "error", message } });
      get().pushToast(message);
      } else {
        set({ syncState: { status: "idle" } });
      }
      return null;
    }
    codegenInFlight = true;
    set({ codegenBusy: true, codegenError: null, syncState: { status: "syncing" } });
    let displayResult: CodegenResult | null = null;
    try {
      const paths: string[] = [];
      for (const target of targets) {
        const body = await postCodegen("sync", target);
        dirtyRoots.delete(target.root.id);
        paths.push(body.targetPath);
        // Only the focused screen's result feeds the code view — a background
        // token resync must not switch the panel to another screen's file.
        if (target.root.id === displayRootId) displayResult = body;
      }
      if (displayResult) {
        applyCodegenResult(displayResult);
        if (source === "manual") set({ activeArtifactId: "screen" });
      }
      workspaceFlags.managedDocument = true;
      set({
        syncState: {
          status: "synced",
          path: paths.length === 1 ? paths[0] : `${paths.length} files`,
        },
        status: `${source === "auto" ? "Autosynced" : "Synced"} ${paths.join(" · ")}`,
      });
      void get().refreshGitStatus();
      void get().loadRepoContext();
      return displayResult;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed";
      set({ codegenError: message, status: message, syncState: { status: "error", message } });
      get().pushToast(message);
      return null;
    } finally {
      codegenInFlight = false;
      set({ codegenBusy: false });
      if (rerunRequested) {
        rerunRequested = false;
        get().scheduleAutoSync();
      }
    }
  };

  const applyConnectedRepo = async (
    body: {
      repoPath?: string;
      git?: Partial<Extract<GitStatus, { status: "ready" }>>;
      context?: RepoPanelContext;
    },
    fallbackPath: string,
  ) => {
    const nextPath = body.repoPath ?? fallbackPath;
    set({ repoPath: nextPath, repoDraft: nextPath });
    if (body.git) {
      set({
        gitStatus: {
          status: "ready",
          repoPath: body.git.repoPath ?? nextPath,
          branch: body.git.branch ?? "unknown",
          clean: !!body.git.clean,
          files: Array.isArray(body.git.files) ? body.git.files : [],
        },
      });
    } else {
      await get().refreshGitStatus();
    }
    if (body.context) {
      set({ repoContext: body.context });
      get().reconcileFlowsWithRepo();
    } else {
      await get().loadRepoContext();
    }
    workspaceFlags.managedDocument = false;
    set({ activeRepoScreen: null, loadedRepoScreens: {} });
    void get().refreshBranches();
    // Frame arrangement is per-repo state; pick up the new repo's layout.
    void get().loadCanvasManifest();
    const target =
      body.context?.designSession?.syncTarget ?? body.git?.branch ?? "current branch";
    set({ status: `Connected ${nextPath} · open a screen to edit ${target}` });
  };

  /** Shared guard + teardown for the three repo-connection entry points. */
  const beginRepoSwitch = (): boolean => {
    if (codegenInFlight) {
      const message = "Wait for the current sync to finish before changing repositories.";
      set({ repoError: message, status: message });
      get().pushToast(message);
      return false;
    }
    if (autoSyncTimer) {
      clearTimeout(autoSyncTimer);
      autoSyncTimer = null;
    }
    set({ syncState: { status: "idle" }, repoBusy: true, repoError: null });
    return true;
  };

  const openLoadedDocument = (opts: {
    mode: "replace" | "merge";
    root: Node;
    components?: ComponentRegistry;
    tokens?: TokenRegistry;
    screenName: string;
    targetPath: string;
    sidecarPath: string;
    repoPath?: string;
  }) => {
    // The file is the canonical source: we just read it, so don't echo it
    // straight back out (writers fire only on subsequent in-tool edits).
    workspaceFlags.skipTokenWrite = true;
    workspaceFlags.skipCodeSync = true;
    const state = useDocumentStore.getState();
    const previousLoadedScreen = Object.values(get().loadedRepoScreens).find(
      (screen) =>
        screen.path === opts.targetPath ||
        screen.path === opts.sidecarPath ||
        screen.sidecarPath === opts.targetPath ||
        screen.sidecarPath === opts.sidecarPath,
    );
    const nextRoots = opts.mode === "merge" ? { ...state.roots } : {};
    if (
      opts.mode === "merge" &&
      previousLoadedScreen &&
      previousLoadedScreen.rootId !== opts.root.id
    ) {
      delete nextRoots[previousLoadedScreen.rootId];
    }
    nextRoots[opts.root.id] = opts.root;
    const nextComponents =
      opts.mode === "merge"
        ? { ...state.components, ...(opts.components ?? {}) }
        : opts.components;
    const nextTokens =
      opts.mode === "merge" ? { ...state.tokens, ...(opts.tokens ?? {}) } : opts.tokens;
    state.loadRoots(nextRoots, [opts.root.id], nextComponents, nextTokens);
    studioHooks.onRepoDocumentOpened(opts.root.id);
    const repoScreen: ActiveRepoScreen = {
      path: opts.targetPath,
      sidecarPath: opts.sidecarPath,
      rootId: opts.root.id,
      screenName: opts.screenName,
    };
    set((current) => ({
      screenName: opts.screenName,
      targetPath: opts.targetPath,
      sidecarPath: opts.sidecarPath,
      ...(opts.repoPath ? { repoPath: opts.repoPath, repoDraft: opts.repoPath } : {}),
      activeRepoScreen: repoScreen,
      // Injective on rootId: a prior binding of this root under another path is
      // superseded (loadRoots just replaced that root's document).
      loadedRepoScreens: bindLoadedRepoScreen(
        current.loadedRepoScreens,
        opts.targetPath,
        repoScreen,
        opts.mode,
      ),
    }));
    workspaceFlags.managedDocument = true;
    applyCodegenResult(null);
    void get().loadRepoContext();
    // Populate the code view live — no manual Preview needed.
    void get().requestCodegen("preview");
  };

  return {
    status: "Drag a frame · resize from handles · add from the toolbar",
    gitStatus: { status: "loading" },
    syncState: { status: "idle" },
    screenName: "Screen",
    targetPath: "generated/Screen.tsx",
    sidecarPath: "generated/Screen.rncanvas.json",
    codegenResult: null,
    codegenBusy: false,
    codegenError: null,
    activeArtifactId: "screen",
    headByPath: {},
    branchInfo: { current: "", branches: [] },
    repoPath: "",
    repoDraft: "",
    repoError: null,
    repoBusy: false,
    repoContext: null,
    activeRepoScreen: null,
    loadedRepoScreens: {},
    flowsById: defaultFlowsById(),
    flowOrder: DEFAULT_FLOWS.map((flow) => flow.id),
    flowPositions: {},
    flowWireMode: false,

    toasts: [],
    pushToast: (message) =>
      set((state) => {
        // Collapse duplicates: re-raising the same failure refreshes, not stacks.
        const kept = state.toasts.filter((toast) => toast.message !== message);
        return { toasts: [...kept, { id: nextToastId++, message }].slice(-4) };
      }),
    dismissToast: (id) =>
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

    setStatus: (status) => set({ status }),
    setRepoDraft: (repoDraft) => set({ repoDraft }),
    setActiveArtifactId: (activeArtifactId) => set({ activeArtifactId }),
    setActiveRepoScreen: (activeRepoScreen) => set({ activeRepoScreen }),
    setScreenName: (screenName) => {
      if (screenName === get().screenName) return;
      set({ screenName });
      const focused = syncRoot();
      if (focused) {
        if (focused.design?.name !== screenName) {
          useDocumentStore.getState().updateDesign(focused.id, focused.id, {
            name: screenName.trim() || undefined,
          });
        }
        dirtyRoots.add(focused.id);
        get().scheduleAutoSync();
      }
    },
    setTargetPath: (targetPath) => {
      if (targetPath === get().targetPath) return;
      set({ targetPath });
      const focused = syncRoot();
      if (focused) {
        dirtyRoots.add(focused.id);
        get().scheduleAutoSync();
      }
    },
    setSidecarPath: (sidecarPath) => set({ sidecarPath }),

    refreshGitStatus: async () => {
      try {
        const res = await fetch("/api/git/status");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        const previousRepoPath = get().repoPath;
        if (body.repoPath) {
          set((state) => ({
            repoPath: body.repoPath,
            repoDraft: state.repoDraft || body.repoPath,
          }));
        }
        const next: GitStatus = {
          status: "ready",
          repoPath: body.repoPath ?? get().repoPath,
          branch: body.branch ?? "unknown",
          clean: !!body.clean,
          files: Array.isArray(body.files) ? body.files : [],
        };
        // The 5s poll usually returns the same answer — don't re-render for it.
        if (JSON.stringify(next) !== JSON.stringify(get().gitStatus)) {
          set({ gitStatus: next });
        }
        if (body.repoPath && body.repoPath !== previousRepoPath) void get().refreshBranches();
      } catch (error) {
        set({
          gitStatus: {
            status: "error",
            message: error instanceof Error ? error.message : "Git status failed",
          },
        });
      }
    },

    refreshBranches: async () => {
      try {
        const res = await fetch("/api/git/branches");
        const body = await res.json();
        if (res.ok) {
          set({ branchInfo: { current: body.current ?? "", branches: body.branches ?? [] } });
        }
      } catch {
        /* branches unavailable — leave prior value */
      }
    },

    refreshHeads: async (list) => {
      if (list.length === 0) {
        set({ headByPath: {} });
        return;
      }
      const entries = await Promise.all(
        list.map(async (artifact) => {
          try {
            const res = await fetch("/api/git/head-file", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: artifact.path }),
            });
            const body = await res.json();
            return [artifact.path, res.ok && body.exists ? (body.content as string) : null] as const;
          } catch {
            return [artifact.path, null] as const;
          }
        }),
      );
      const map: Record<string, string> = {};
      for (const [path, content] of entries) if (content != null) map[path] = content;
      set({ headByPath: map });
    },

    loadRepo: async () => {
      try {
        const res = await fetch("/api/repo");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        set({
          repoPath: body.repoPath ?? "",
          repoDraft: body.repoPath ?? "",
          repoContext: body.context ?? null,
        });
        get().reconcileFlowsWithRepo();
        void get().refreshBranches();
      } catch (error) {
        set({ repoError: error instanceof Error ? error.message : "Repository load failed" });
      }
    },

    loadRepoContext: async () => {
      try {
        const res = await fetch("/api/repo/context");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        set({ repoContext: body.context ?? body });
        get().reconcileFlowsWithRepo();
      } catch (error) {
        set({ repoError: error instanceof Error ? error.message : "Repository scan failed" });
      }
    },

    loadCanvasManifest: async () => {
      try {
        const res = await fetch("/api/canvas");
        const body = (await res.json()) as {
          positions?: Record<NodeId, { x: number; y: number }>;
          flowPositions?: FlowPositions;
        };
        if (res.ok) {
          const positions = body.positions ?? {};
          const flowPositions = body.flowPositions ?? {};
          canvasSaved = canvasPayload(positions, flowPositions);
          useDocumentStore.getState().seedFramePositions(positions);
          set({ flowPositions });
        }
      } catch {
        // No canvas manifest is the normal first-run state.
      }
    },

    createRepoScreen: async () => {
      if (codegenInFlight) {
        const message = "Wait for the current sync to finish before creating a screen.";
        set({ status: message });
        get().pushToast(message);
        return null;
      }
      if (!get().repoContext) await get().loadRepoContext();
      const context = get().repoContext;
      const docState = useDocumentStore.getState();
      const screenRoots = Object.values(docState.roots).filter(
        (root) => root.id !== docState.editingComponentId,
      );
      const repoNames = (context?.screens ?? []).map(displayScreenName);
      const screenName = nextScreenName(screenRoots, repoNames);
      const targetPath = nextScreenTargetPath(context, screenName);
      const root = createScreenFrame([], screenName);

      codegenInFlight = true;
      set({ codegenBusy: true, codegenError: null, syncState: { status: "syncing" } });
      try {
        const body = await postCodegen("sync", {
          root,
          screenName,
          targetPath,
          ifAbsent: true,
        });
        workspaceFlags.skipCodeSync = true;
        useDocumentStore.getState().loadRoots(
          { ...useDocumentStore.getState().roots, [root.id]: root },
          [root.id],
          useDocumentStore.getState().components,
          useDocumentStore.getState().tokens,
        );
        studioHooks.onRepoDocumentOpened(root.id);
        const repoScreen: ActiveRepoScreen = {
          path: body.targetPath,
          sidecarPath: body.sidecarPath,
          rootId: root.id,
          screenName: body.screenName,
        };
        set((state) => ({
          screenName: body.screenName,
          targetPath: body.targetPath,
          sidecarPath: body.sidecarPath,
          activeRepoScreen: repoScreen,
          loadedRepoScreens: bindLoadedRepoScreen(
            state.loadedRepoScreens,
            body.targetPath,
            repoScreen,
            "merge",
          ),
          syncState: { status: "synced", path: body.targetPath },
          status: `Created ${body.targetPath}`,
        }));
        dirtyRoots.delete(root.id);
        workspaceFlags.managedDocument = true;
        applyCodegenResult(body);
        void get().refreshGitStatus();
        void get().loadRepoContext();
        return root;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Screen creation failed";
        set({ codegenError: message, status: message, syncState: { status: "error", message } });
        get().pushToast(message);
        return null;
      } finally {
        codegenInFlight = false;
        set({ codegenBusy: false });
      }
    },

    renameRepoScreen: (rootId, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const doc = useDocumentStore.getState();
      const root = doc.roots[rootId];
      if (!root || root.design?.name === trimmed) return;
      doc.updateDesign(rootId, rootId, { name: trimmed });
      dirtyRoots.add(rootId);
      syncRootHint = rootId;
      set((state) => {
        const loadedRepoScreens = Object.fromEntries(
          Object.entries(state.loadedRepoScreens).map(([key, screen]) => [
            key,
            screen.rootId === rootId ? { ...screen, screenName: trimmed } : screen,
          ]),
        );
        const activeRepoScreen =
          state.activeRepoScreen?.rootId === rootId
            ? { ...state.activeRepoScreen, screenName: trimmed }
            : state.activeRepoScreen;
        return {
          loadedRepoScreens,
          activeRepoScreen,
          screenName: activeRepoScreen?.rootId === rootId ? trimmed : state.screenName,
          status: `Renamed screen to ${trimmed}`,
        };
      });
      get().scheduleAutoSync();
    },

    deleteRepoScreen: async (screen) => {
      if (!screen.sidecarPath || !screen.rnCanvas) {
        const message = "Only RNCanvas-owned screens can be deleted";
        set({ status: message });
        get().pushToast(message);
        return;
      }
      const res = await fetch("/api/screens/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPath: screen.path, sidecarPath: screen.sidecarPath }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);

      const { byPath } = screenPathMap(get().loadedRepoScreens);
      const loaded = byPath.get(screen.path) ?? byPath.get(screen.sidecarPath);
      if (loaded) {
        useDocumentStore.getState().removeRoot(loaded.rootId);
        dirtyRoots.delete(loaded.rootId);
      }
      const deletedPaths = new Set([screen.path, screen.sidecarPath]);
      const deletedRootId = loaded?.rootId;
      const nextFlows = flowsFromState(get()).map((flow) => {
        const routes = deletedRootId
          ? flow.routes.filter((rootId) => rootId !== deletedRootId)
          : flow.routes;
        const routeSet = new Set(routes);
        return {
          ...flow,
          routes,
          entryRootId:
            flow.entryRootId && routeSet.has(flow.entryRootId) ? flow.entryRootId : routes[0],
          successRootId:
            flow.successRootId && routeSet.has(flow.successRootId) ? flow.successRootId : undefined,
          edges: flow.edges.filter((edge) => routeSet.has(edge.from.rootId) && routeSet.has(edge.to)),
          manifestRoutes: (flow.manifestRoutes ?? []).filter(
            (route) =>
              !(route.path && deletedPaths.has(route.path)) &&
              !(deletedRootId && route.rootId === deletedRootId),
          ),
          manifestEdges: (flow.manifestEdges ?? []).filter(
            (edge) =>
              !(edge.from.path && deletedPaths.has(edge.from.path)) &&
              !(edge.toPath && deletedPaths.has(edge.toPath)) &&
              !(deletedRootId && edge.from.rootId === deletedRootId) &&
              !(deletedRootId && edge.to === deletedRootId),
          ),
        };
      });
      if (syncRootHint && deletedRootId === syncRootHint) syncRootHint = null;
      set((state) => {
        const loadedRepoScreens = Object.fromEntries(
          Object.entries(state.loadedRepoScreens).filter(
            ([key, value]) =>
              !deletedPaths.has(key) &&
              !deletedPaths.has(value.path) &&
              (!value.sidecarPath || !deletedPaths.has(value.sidecarPath)) &&
              (!deletedRootId || value.rootId !== deletedRootId),
          ),
        );
        const wasActive =
          !!state.activeRepoScreen &&
          (deletedPaths.has(state.activeRepoScreen.path) ||
            (!!state.activeRepoScreen.sidecarPath &&
              deletedPaths.has(state.activeRepoScreen.sidecarPath)) ||
            (!!deletedRootId && state.activeRepoScreen.rootId === deletedRootId));
        // The editable sync fields described the deleted screen; left stale
        // they would point future syncs at the removed file.
        const clearedFields = wasActive
          ? { screenName: "", targetPath: "", sidecarPath: "" }
          : {};
        return {
          loadedRepoScreens,
          activeRepoScreen: wasActive ? null : state.activeRepoScreen,
          ...clearedFields,
          flowsById: Object.fromEntries(nextFlows.map((flow) => [flow.id, flow])),
          status: `Deleted ${screen.path}`,
        };
      });
      await get().persistFlowManifest(nextFlows);
      void get().refreshGitStatus();
      void get().loadRepoContext();
    },

    applyFlowManifest: (body) => {
      const screenRoots = screenRootsFromDocument();
      const { loadedRepoScreens, repoContext } = get();
      const manifestFlows = body.flows
        .filter((flow) => typeof flow.id === "string" && typeof flow.label === "string")
        .map((flow) =>
          manifestFlowToDefinition(flow, screenRoots, loadedRepoScreens, repoContext),
        );
      if (manifestFlows.length === 0) return;
      set({
        flowsById: Object.fromEntries(manifestFlows.map((flow) => [flow.id, flow])),
        flowOrder: manifestFlows.map((flow) => flow.id),
      });
    },

    reconcileFlowsWithRepo: () => {
      // Flow manifests can apply before the repo scan lands (routes kept
      // permissively). Once the scan is here, round-trip the current flows
      // through the manifest form so dead routes prune and counts settle.
      // The pruned state reaches flows.json on the next explicit flow save.
      const repoContext = get().repoContext;
      if (!repoContext) return;
      const flows = flowsFromState(get());
      if (flows.length === 0) return;
      const manifest = flowDefinitionsToManifest(
        flows,
        screenRootsFromDocument(),
        get().loadedRepoScreens,
        repoContext,
      );
      get().applyFlowManifest(manifest);
    },

    loadFlowManifest: async () => {
      try {
        const res = await fetch("/api/flows");
        const body = (await res.json()) as FlowManifest & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        get().applyFlowManifest(body);
      } catch {
        // A missing flow manifest is fine; flows start from inferred screen order.
      }
    },

    persistFlowManifest: async (nextFlows, screenRootsOverride) => {
      const screenRoots = screenRootsOverride ?? screenRootsFromDocument();
      const flows = nextFlows ?? flowsFromState(get());
      const { loadedRepoScreens, repoContext } = get();
      const manifest = flowDefinitionsToManifest(flows, screenRoots, loadedRepoScreens, repoContext);
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifest }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      void get().refreshGitStatus();
      void get().loadRepoContext();
    },

    setFlowEntryRoot: async (flowId, rootId) => {
      const flow = get().flowsById[flowId];
      if (!flow) return;
      const nextFlow = { ...flow, entryRootId: rootId };
      const nextFlows = flowsFromState(get()).map((item) =>
        item.id === flowId ? nextFlow : item,
      );
      set((state) => ({ flowsById: { ...state.flowsById, [flowId]: nextFlow } }));
      await get().persistFlowManifest(nextFlows);
    },

    updateFlowRoutes: async (flowId, routeIds, screenRoots = screenRootsFromDocument()) => {
      const flow = get().flowsById[flowId];
      if (!flow) return;
      const routes = routeIds.filter((rootId, index) => routeIds.indexOf(rootId) === index);
      const routeSet = new Set(routes);
      const nextFlow = {
        ...flow,
        routes,
        entryRootId: flow.entryRootId && routeSet.has(flow.entryRootId) ? flow.entryRootId : routes[0],
        successRootId:
          flow.successRootId && routeSet.has(flow.successRootId) ? flow.successRootId : undefined,
        edges: deriveLinearEdges(routes),
      };
      const nextFlows = flowsFromState(get()).map((item) =>
        item.id === flowId ? nextFlow : item,
      );
      set((state) => ({ flowsById: { ...state.flowsById, [flowId]: nextFlow } }));
      await get().persistFlowManifest(nextFlows, screenRoots);
    },

    addFlowEdge: async (flowId, edge) => {
      const flow = get().flowsById[flowId];
      if (!flow) return;
      const nextEdges = addFlowEdge(flow.edges, flow.routes, edge);
      if (JSON.stringify(nextEdges) === JSON.stringify(flow.edges)) return;
      const nextFlow = { ...flow, edges: nextEdges };
      const nextFlows = flowsFromState(get()).map((item) =>
        item.id === flowId ? nextFlow : item,
      );
      set((state) => ({ flowsById: { ...state.flowsById, [flowId]: nextFlow } }));
      await get().persistFlowManifest(nextFlows);
      if (!edge.from.anchorNodeId) return;
      const source = Object.values(get().loadedRepoScreens).find(
        (screen) => screen.rootId === edge.from.rootId,
      );
      const target = Object.values(get().loadedRepoScreens).find(
        (screen) => screen.rootId === edge.to,
      );
      if (!source?.sidecarPath || !target?.path) {
        set({ status: "Flow edge saved as manifest intent; source is not rncanvas-owned" });
        return;
      }
      const doc = useDocumentStore.getState();
      const root = doc.roots[edge.from.rootId];
      if (!root) return;
      const res = await fetch("/api/flows/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "add-edge",
          sourcePath: source.path,
          targetPath: target.path,
          anchorNodeId: edge.from.anchorNodeId,
          root,
          screenName: source.screenName,
          components: doc.components,
          tokens: doc.tokens,
        }),
      });
      const body = (await res.json()) as FlowApplyResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      applyCodegenResult(body);
      void get().refreshGitStatus();
      void get().loadRepoContext();
    },

    hydrateRepoFlows: (flows) => {
      if (flows.length === 0) return;
      set((state) => {
        const flowsById = { ...state.flowsById };
        const repoIds = new Set(flows.map((flow) => flow.id));
        for (const id of Object.keys(flowsById)) {
          if (id.startsWith("repo-flow:") && !repoIds.has(id)) delete flowsById[id];
        }
        for (const flow of flows) {
          flowsById[flow.id] = flow;
        }
        const manualOrder = state.flowOrder.filter((id) => !id.startsWith("repo-flow:"));
        const repoOrder = flows.map((flow) => flow.id);
        return { flowsById, flowOrder: [...manualOrder, ...repoOrder] };
      });
    },

    upsertFlow: async (flow) => {
      const current = flowsFromState(get());
      const exists = current.some((item) => item.id === flow.id);
      const nextFlows = exists
        ? current.map((item) => (item.id === flow.id ? flow : item))
        : [...current, flow];
      set((state) => ({
        flowsById: { ...state.flowsById, [flow.id]: flow },
        flowOrder: exists ? state.flowOrder : [...state.flowOrder, flow.id],
      }));
      await get().persistFlowManifest(nextFlows);
    },

    removeFlow: async (flowId) => {
      const nextFlows = flowsFromState(get()).filter((flow) => flow.id !== flowId);
      if (nextFlows.length === 0) return;
      set((state) => {
        const flowsById = { ...state.flowsById };
        delete flowsById[flowId];
        const flowPositions = { ...state.flowPositions };
        delete flowPositions[flowId];
        return {
          flowsById,
          flowPositions,
          flowOrder: state.flowOrder.filter((id) => id !== flowId),
        };
      });
      saveCanvasManifestLater();
      await get().persistFlowManifest(nextFlows);
    },

    setFlowPosition: (flowId, rootId, x, y) => {
      set((state) => ({
        flowPositions: {
          ...state.flowPositions,
          [flowId]: {
            ...(state.flowPositions[flowId] ?? {}),
            [rootId]: { x, y },
          },
        },
      }));
      saveCanvasManifestLater();
    },

    setFlowWireMode: (flowWireMode) => {
      set({ flowWireMode, status: flowWireMode ? "Flow wiring handles visible" : "Flow wiring handles hidden" });
    },

    seedFlowPositions: (flowPositions) => {
      set({ flowPositions });
    },

    requestCodegen: async (mode, source = "manual") => {
      if (mode === "sync") {
        // Every sync goes through the dirty-root flush; a manual sync also
        // covers the focused screen even if nothing marked it dirty yet.
        const focused = syncRoot();
        if (focused) dirtyRoots.add(focused.id);
        return flushSync(source);
      }
      const root = syncRoot();
      if (!root) {
        const message = "Select a screen before previewing.";
        set({ codegenError: message, status: message });
        get().pushToast(message);
        return null;
      }
      if (codegenInFlight) {
        if (source === "auto") rerunRequested = true;
        return null;
      }
      codegenInFlight = true;
      set({ codegenBusy: true, codegenError: null });
      try {
        const body = await postCodegen("preview", {
          root,
          screenName: get().screenName,
          targetPath: get().targetPath,
        });
        applyCodegenResult(body);
        if (source === "manual") set({ activeArtifactId: "screen" });
        set({ status: `Previewed generated files for ${body.targetPath}` });
        return body;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Preview failed";
        set({ codegenError: message, status: message });
        get().pushToast(message);
        return null;
      } finally {
        codegenInFlight = false;
        set({ codegenBusy: false });
        if (rerunRequested) {
          rerunRequested = false;
          get().scheduleAutoSync();
        }
      }
    },

    scheduleAutoSync: () => {
      if (!workspaceFlags.managedDocument) {
        set({ syncState: { status: "idle" } });
        return;
      }
      if (autoSyncTimer) clearTimeout(autoSyncTimer);
      set({ syncState: { status: "scheduled" } });
      autoSyncTimer = setTimeout(() => {
        autoSyncTimer = null;
        if (codegenInFlight) {
          // Don't drop this edit — the in-flight codegen will re-run when it finishes.
          rerunRequested = true;
          return;
        }
        void flushSync("auto");
      }, 900);
    },

    openSidecar: async (path = get().sidecarPath, mode = "replace") => {
      set({ codegenBusy: true, codegenError: null });
      try {
        const res = await fetch("/api/documents/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sidecarPath: path }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        const opened = body as OpenDocumentResult;
        openLoadedDocument({
          mode,
          root: opened.root,
          components: opened.components,
          tokens: opened.tokens,
          screenName: opened.screenName,
          targetPath: opened.targetPath,
          sidecarPath: opened.sidecarPath,
          repoPath: opened.repoPath,
        });
        set({ status: `Opened ${opened.sidecarPath}` });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Document load failed";
        set({ codegenError: message, status: message });
        get().pushToast(message);
      } finally {
        set({ codegenBusy: false });
      }
    },

    importSource: async (path = get().targetPath, mode = "replace") => {
      set({ codegenBusy: true, codegenError: null });
      try {
        const res = await fetch("/api/documents/import-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourcePath: path }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        const imported = body as ImportSourceResult;
        openLoadedDocument({
          mode,
          root: imported.root,
          screenName: imported.screenName,
          targetPath: imported.sourcePath,
          sidecarPath: imported.sidecarPath,
          repoPath: imported.repoPath,
        });
        set({ status: `Imported ${imported.sourcePath}` });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Code import failed";
        set({ codegenError: message, status: message });
        get().pushToast(message);
      } finally {
        set({ codegenBusy: false });
      }
    },

    connectRepo: async () => {
      if (!beginRepoSwitch()) return;
      try {
        const res = await fetch("/api/repo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoPath: get().repoDraft }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        await applyConnectedRepo(body, get().repoDraft);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Repository connection failed";
        set({ repoError: message, status: message });
        get().pushToast(message);
      } finally {
        set({ repoBusy: false });
      }
    },

    selectRepoFolder: async () => {
      if (!beginRepoSwitch()) return;
      try {
        const res = await fetch("/api/repo/select-folder", { method: "POST" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        await applyConnectedRepo(body, get().repoDraft);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Folder selection failed";
        set({ repoError: message, status: message });
        get().pushToast(message);
      } finally {
        set({ repoBusy: false });
      }
    },

    connectDemoRepo: async () => {
      if (!beginRepoSwitch()) return;
      try {
        const res = await fetch("/api/repo/demo", { method: "POST" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        await applyConnectedRepo(body, body.repoPath ?? get().repoDraft);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Demo repository connection failed";
        set({ repoError: message, status: message });
        get().pushToast(message);
      } finally {
        set({ repoBusy: false });
      }
    },

    switchBranch: async (branch, create = false) => {
      set({ repoError: null });
      try {
        const res = await fetch("/api/git/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch, create }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Branch switch failed");
        await get().refreshGitStatus();
        await get().refreshBranches();
        void get().loadRepoContext();
        // The working tree now reflects the new branch — reload the open document.
        void get().openSidecar();
      } catch (e) {
        const message = e instanceof Error ? e.message : "Branch switch failed";
        set({ repoError: message });
        get().pushToast(message);
      }
    },

    commitChanges: async (message) => {
      set({ repoError: null });
      try {
        const res = await fetch("/api/git/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Commit failed");
        set({ status: `Committed: ${message}` });
        await get().refreshGitStatus();
        await get().refreshBranches();
        // The commit moved HEAD — rebase the diff baseline on it.
        void get().refreshHeads(codeArtifacts(get().codegenResult));
      } catch (e) {
        const message = e instanceof Error ? e.message : "Commit failed";
        set({ repoError: message });
        get().pushToast(message);
      }
    },

    openPullRequest: async () => {
      set({ repoError: null });
      try {
        const res = await fetch("/api/git/pr-url");
        const body = await res.json();
        if (body.url) window.open(body.url, "_blank", "noopener");
        else set({ repoError: "No origin remote to open a pull request against." });
      } catch (e) {
        set({
          repoError: e instanceof Error ? e.message : "Could not resolve pull request URL",
        });
      }
    },
  };
});

/**
 * Document-store subscriptions that drive the pipeline: auto-sync scheduling,
 * the canonical theme.ts writer, and the canvas-layout writer. Installed once
 * from App; returns a cleanup.
 */
export function initWorkspaceSubscriptions(): () => void {
  const docStore = useDocumentStore;
  const workspace = useWorkspaceStore;

  // Auto-sync: schedule after document edits, batched across interactions.
  // Per-root reference diffing feeds the dirty set so a flush writes every
  // edited screen's file, not just the focused one.
  let lastRoots = docStore.getState().roots;
  let lastComponents = docStore.getState().components;
  let lastTokens = docStore.getState().tokens;
  let lastInteraction = docStore.getState().interaction;
  let dirtyDuringInteraction = false;
  const unsubscribeAutoSync = docStore.subscribe((state) => {
    const previousRoots = lastRoots;
    const rootsChanged = state.roots !== lastRoots;
    const globalsChanged =
      state.components !== lastComponents || state.tokens !== lastTokens;
    const documentChanged = rootsChanged || globalsChanged;
    const interactionJustEnded = !!lastInteraction && !state.interaction;
    lastRoots = state.roots;
    lastComponents = state.components;
    lastTokens = state.tokens;
    lastInteraction = state.interaction;
    if (interactionJustEnded && dirtyDuringInteraction) {
      dirtyDuringInteraction = false;
      workspace.getState().scheduleAutoSync();
      return;
    }
    if (!documentChanged) return;
    if (workspaceFlags.skipCodeSync) {
      workspaceFlags.skipCodeSync = false; // a load, not an edit — nothing dirties
      return;
    }
    if (rootsChanged) {
      for (const [id, root] of Object.entries(state.roots)) {
        if (previousRoots[id] !== root) dirtyRoots.add(id);
      }
    }
    if (globalsChanged) {
      // Tokens/components reapply across every tree — all screens are stale.
      for (const id of Object.keys(state.roots)) {
        if (id !== state.editingComponentId) dirtyRoots.add(id);
      }
    }
    if (state.interaction) {
      dirtyDuringInteraction = true;
      return;
    }
    workspace.getState().scheduleAutoSync();
  });

  // Single-writer canonical token file: theme.ts follows the token registry.
  // Debounced and fire-and-forget; never touches the canvas interaction path.
  let tokenTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTokensForWrite = docStore.getState().tokens;
  const unsubscribeTokens = docStore.subscribe((state) => {
    if (state.tokens === lastTokensForWrite) return;
    lastTokensForWrite = state.tokens;
    if (workspaceFlags.skipTokenWrite) {
      workspaceFlags.skipTokenWrite = false; // this change was a load, not an edit
      return;
    }
    if (tokenTimer) clearTimeout(tokenTimer);
    tokenTimer = setTimeout(() => {
      const path = workspace.getState().sidecarPath;
      if (!path) return;
      void fetch("/api/tokens/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sidecarPath: path, tokens: docStore.getState().tokens }),
      }).catch(() => {});
    }, 400);
  });

  // Canvas layout writer: frame arrangement → .rncanvas/canvas.json.
  let lastPositions = docStore.getState().framePositions;
  const unsubscribeCanvas = docStore.subscribe((state) => {
    if (state.framePositions === lastPositions) return;
    lastPositions = state.framePositions;
    saveCanvasManifestLater();
  });

  return () => {
    unsubscribeAutoSync();
    unsubscribeTokens();
    unsubscribeCanvas();
    if (tokenTimer) clearTimeout(tokenTimer);
    if (canvasSaveTimer) clearTimeout(canvasSaveTimer);
    if (autoSyncTimer) {
      clearTimeout(autoSyncTimer);
      autoSyncTimer = null;
    }
  };
}
