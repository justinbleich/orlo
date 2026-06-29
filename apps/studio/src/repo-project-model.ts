export type RepoPanelContext = {
  repoPath: string;
  repoName: string;
  packageManager: string;
  frameworks: Array<{ id: string; label: string; detail?: string }>;
  flows?: Array<{
    id: string;
    label: string;
    description?: string;
    routeKind?: string;
    screenPaths: string[];
  }>;
  screens: Array<{
    path: string;
    name: string;
    kind: "source" | "sidecar";
    sidecarPath?: string;
    routeKind: "expo-router" | "react-navigation" | "unknown";
    rnCanvas: boolean;
  }>;
  sidecars: Array<{ path: string; screenName?: string; targetPath?: string }>;
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
