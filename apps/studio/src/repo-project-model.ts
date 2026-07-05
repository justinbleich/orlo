export type RepoPanelContext = {
  repoPath: string;
  repoName: string;
  gitRootPath?: string;
  gitRootName?: string;
  packageManager: string;
  designSession?: {
    mode: "current-branch" | "studio-branch";
    branch: string;
    suggestedBranch: string;
    syncTarget: string;
    worktreePath: string;
  };
  frameworks: Array<{ id: string; label: string; detail?: string }>;
  flows?: Array<{
    id: string;
    label: string;
    description?: string;
    routeKind?: string;
    screenPaths: string[];
    entryPath?: string;
    edges?: Array<{
      fromPath: string;
      toPath: string;
      kind: "primary" | "conditional" | "fallback";
      condition?: string;
      anchorNodeId?: string;
    }>;
  }>;
  screens: Array<{
    path: string;
    name: string;
    kind: "source" | "sidecar";
    sidecarPath?: string;
    routeKind: "expo-router" | "react-navigation" | "unknown";
    rnCanvas: boolean;
  }>;
  sidecars: Array<{ path: string; rootId?: string; screenName?: string; targetPath?: string }>;
  assets: Array<{ path: string; kind: string }>;
  entrypoints: string[];
  truncated?: boolean;
};

export type RepoPanelScreen = RepoPanelContext["screens"][number];
export type RepoFlowPanelItem = {
  id: string;
  name: string;
  description?: string;
  routeKind?: string;
  screens: RepoPanelScreen[];
  entryPath?: string;
  edges: NonNullable<NonNullable<RepoPanelContext["flows"]>[number]["edges"]>;
};
export type RepoGitFileStatus = { path: string; index: string; workingTree: string };
export type RepoChangeGroup = {
  id: string;
  label: string;
  kind: "flow" | "screen" | "component" | "design-system" | "asset" | "project";
  detail: string;
  files: RepoGitFileStatus[];
};

function titleFromSegment(segment: string) {
  const clean = segment
    .replace(/^\((.+)\)$/, "$1")
    .replace(/^\[(.+)\]$/, "$1")
    .replace(/\.[^.]+$/, "");
  const words = clean
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter(Boolean);
  if (words.length === 0) return clean || "Untitled";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function displayScreenName(screen: RepoPanelScreen) {
  if (/[A-Z\s]/.test(screen.name)) return screen.name;
  return titleFromSegment(screen.name);
}

export function repoFlowItemsForContext(repoContext?: RepoPanelContext | null): RepoFlowPanelItem[] {
  if (!repoContext) return [];
  const screenByPath = new Map(repoContext.screens.map((screen) => [screen.path, screen]));
  return (repoContext.flows ?? [])
    .map((flow) => ({
      id: flow.id,
      name: flow.label,
      description: flow.description,
      routeKind: flow.routeKind,
      entryPath: flow.entryPath,
      edges: flow.edges ?? [],
      screens: flow.screenPaths
        .map((path) => screenByPath.get(path))
        .filter((screen): screen is RepoPanelScreen => !!screen),
    }))
    .filter((flow) => flow.screens.length > 0);
}

function matchesPath(changedPath: string, candidatePath?: string) {
  return !!candidatePath && (changedPath === candidatePath || changedPath.endsWith(`/${candidatePath}`));
}

function changeGroupForFile(repoContext: RepoPanelContext | null | undefined, file: RepoGitFileStatus) {
  const path = file.path;
  if (path === ".rncanvas/flows.json" || path.endsWith("/.rncanvas/flows.json")) {
    return {
      id: "project-flow-settings",
      label: "Project Flow Settings",
      kind: "flow" as const,
      detail: "Flow metadata",
    };
  }

  const screen = repoContext?.screens.find(
    (candidate) => matchesPath(path, candidate.path) || matchesPath(path, candidate.sidecarPath),
  );
  if (screen) {
    return {
      id: `screen:${screen.path}`,
      label: `${displayScreenName(screen)} Screen`,
      kind: "screen" as const,
      detail: screen.path,
    };
  }

  if (/(^|\/)(components|ui)(\/|$)/i.test(path)) {
    const name = titleFromSegment(path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "Component");
    return {
      id: `component:${path}`,
      label: `${name} Component`,
      kind: "component" as const,
      detail: path,
    };
  }

  if (/(^|\/)(tokens|theme)\.[tj]s$/.test(path) || /(^|\/)(tokens|theme)(\/|$)/i.test(path)) {
    return {
      id: "design-system",
      label: "Design System",
      kind: "design-system" as const,
      detail: "Tokens and theme",
    };
  }

  const asset = repoContext?.assets.find((candidate) => matchesPath(path, candidate.path));
  if (asset || /(^|\/)(assets|public|images|fonts|lottie)(\/|$)/i.test(path)) {
    return {
      id: `asset:${path}`,
      label: "Assets",
      kind: "asset" as const,
      detail: asset?.kind ?? "Repository asset",
    };
  }

  return {
    id: "project-files",
    label: "Project Files",
    kind: "project" as const,
    detail: "Repository change",
  };
}

export function repoChangesForContext(
  repoContext: RepoPanelContext | null | undefined,
  files: RepoGitFileStatus[],
): RepoChangeGroup[] {
  const groups = new Map<string, RepoChangeGroup>();
  for (const file of files) {
    const base = changeGroupForFile(repoContext, file);
    const group = groups.get(base.id);
    if (group) {
      group.files.push(file);
      continue;
    }
    groups.set(base.id, { ...base, files: [file] });
  }
  return [...groups.values()];
}

// --- Shared workspace labels ---------------------------------------------------

import type { GitFileStatus, GitStatus } from "./code-artifacts";

export function gitSummary(status: GitStatus): string {
  if (status.status === "loading") return "Git loading";
  if (status.status === "error") return "Git unavailable";
  if (status.clean) return `${status.branch} clean`;
  return `${status.branch} ${status.files.length} changed`;
}

export function pathLabel(path?: string) {
  if (!path) return "None";
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function scopedPathLabel(path?: string, root?: string) {
  if (!path) return "None";
  if (!root || path === root) return pathLabel(path);
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : pathLabel(path);
}

export function gitStatusCodeForFile(file: GitFileStatus): string {
  const code = `${file.index}${file.workingTree}`;
  if (code === "??") return "U";
  if (file.workingTree === "M" || file.index === "M") return "M";
  if (file.workingTree === "D" || file.index === "D") return "D";
  if (file.workingTree === "A" || file.index === "A") return "A";
  if (file.workingTree === "R" || file.index === "R") return "R";
  return code.trim() || "";
}

export function firstGitCode(status: GitStatus): string | undefined {
  if (status.status !== "ready") return undefined;
  return status.files.map(gitStatusCodeForFile).find(Boolean);
}

/**
 * Bind an opened document's path → root association. A root id can hold only
 * one document at a time (the document store's loadRoots merges by id), so any
 * prior binding of the same rootId under another path is superseded. Copied
 * sidecar fixtures share embedded node ids across repos; without this eviction
 * two panel rows claim the same canvas root (doubled active rows + layer
 * accordions) and the sync flush can write the wrong repo's file.
 */
function sameLoadedScreenPath<S extends { path?: string; sidecarPath?: string }>(
  leftKey: string,
  left: S,
  rightKey: string,
  right: S,
) {
  const leftPaths = new Set([leftKey, left.path, left.sidecarPath].filter(Boolean));
  return [rightKey, right.path, right.sidecarPath].some((path) => !!path && leftPaths.has(path));
}

export function bindLoadedRepoScreen<S extends { rootId: string; path?: string; sidecarPath?: string }>(
  current: Record<string, S>,
  path: string,
  screen: S,
  mode: "replace" | "merge",
): Record<string, S> {
  if (mode === "replace") return { [path]: screen };
  const next: Record<string, S> = {};
  for (const [key, value] of Object.entries(current)) {
    if (value.rootId !== screen.rootId && !sameLoadedScreenPath(key, value, path, screen)) {
      next[key] = value;
    }
  }
  next[path] = screen;
  return next;
}
