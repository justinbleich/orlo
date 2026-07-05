import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";

export type FlowEdge = {
  from: { rootId: string; anchorNodeId?: string };
  to: string;
  kind: "primary" | "conditional" | "fallback";
  condition?: string;
};

export type FlowManifestRoute = { rootId: string; name: string; screenKey?: string };

export type FlowManifestFlow = {
  id: string;
  label: string;
  description?: string;
  entryRootId?: string;
  entryName?: string;
  successRootId?: string;
  routes: FlowManifestRoute[];
  edges: FlowEdge[];
};

export type FlowManifest = {
  version: 2;
  updatedAt?: string;
  flows: FlowManifestFlow[];
};

export type GitFileStatus = {
  path: string;
  index: string;
  workingTree: string;
};

export type GitStatus = {
  repoPath: string;
  branch: string;
  clean: boolean;
  files: GitFileStatus[];
};

export function displayBranchName(branchLine: string) {
  const name = branchLine.replace(/^##\s*/, "").split("...")[0]?.trim();
  return name || "detached";
}

export function studioBranchName(root: string, date = new Date()) {
  const repoSlug =
    basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "repo";
  const stamp = date.toISOString().slice(0, 10);
  return `studio/${repoSlug}-${stamp}`;
}

export function pathInRoot(root: string, path: string) {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function resolveRepoPath(root: string, input: string) {
  return resolve(isAbsolute(input) ? input : join(root, input));
}

export function resolveTargetPath(root: string, screenName: string, targetPath?: string) {
  const base = targetPath?.trim()
    ? resolveRepoPath(root, targetPath)
    : join(root, "generated", `${screenName}.tsx`);
  const tsxPath = resolve(base);
  if (!pathInRoot(root, tsxPath)) {
    throw new Error("Sync path must stay inside the connected repository");
  }
  if (extname(tsxPath) !== ".tsx") {
    throw new Error("Code path must end in .tsx");
  }
  const sidecarPath = tsxPath.replace(/\.tsx$/, ".rncanvas.json");
  return { tsxPath, sidecarPath };
}

export function resolveSidecarPath(root: string, input?: string) {
  if (!input?.trim()) throw new Error("Enter a sidecar path");
  const sidecarPath = resolveRepoPath(root, input);
  if (!pathInRoot(root, sidecarPath)) {
    throw new Error("Sidecar path must stay inside the connected repository");
  }
  if (!sidecarPath.endsWith(".rncanvas.json")) {
    throw new Error("Sidecar path must end in .rncanvas.json");
  }
  return sidecarPath;
}

export function resolveExternalSourcePath(root: string, input?: string) {
  if (!input?.trim()) throw new Error("Enter a React Native source path");
  const sourcePath = resolveRepoPath(root, input);
  if (!pathInRoot(root, sourcePath)) {
    throw new Error("Source path must stay inside the connected repository");
  }
  if (![".tsx", ".jsx"].includes(extname(sourcePath))) {
    throw new Error("Source path must end in .tsx or .jsx");
  }
  return sourcePath;
}

export function emptyFlowManifest(): FlowManifest {
  return { version: 2, flows: [] };
}

function linearEdgesFromRoutes(routes: readonly FlowManifestRoute[]): FlowEdge[] {
  const edges: FlowEdge[] = [];
  for (let i = 0; i < routes.length - 1; i += 1) {
    const from = routes[i]?.rootId;
    const to = routes[i + 1]?.rootId;
    if (from && to && from !== to) edges.push({ from: { rootId: from }, to, kind: "primary" });
  }
  return edges;
}

function normalizeFlow(flow: Partial<FlowManifestFlow>): FlowManifestFlow | null {
  if (typeof flow.id !== "string" || typeof flow.label !== "string") return null;
  const routes = Array.isArray(flow.routes)
    ? flow.routes.flatMap((route) =>
        route &&
        typeof route.rootId === "string" &&
        typeof route.name === "string"
          ? [{ rootId: route.rootId, name: route.name, screenKey: route.screenKey }]
          : [],
      )
    : [];
  const routeIds = new Set(routes.map((route) => route.rootId));
  const edges = Array.isArray(flow.edges)
    ? flow.edges.flatMap((edge) => {
        if (
          !edge ||
          !edge.from ||
          typeof edge.from.rootId !== "string" ||
          typeof edge.to !== "string" ||
          !["primary", "conditional", "fallback"].includes(edge.kind)
        ) {
          return [];
        }
        if (!routeIds.has(edge.from.rootId) || !routeIds.has(edge.to)) return [];
        return [
          {
            from: {
              rootId: edge.from.rootId,
              anchorNodeId:
                typeof edge.from.anchorNodeId === "string" ? edge.from.anchorNodeId : undefined,
            },
            to: edge.to,
            kind: edge.kind,
            condition: typeof edge.condition === "string" ? edge.condition : undefined,
          },
        ];
      })
    : linearEdgesFromRoutes(routes);
  return {
    id: flow.id,
    label: flow.label,
    description: typeof flow.description === "string" ? flow.description : undefined,
    entryRootId: typeof flow.entryRootId === "string" ? flow.entryRootId : undefined,
    entryName: typeof flow.entryName === "string" ? flow.entryName : undefined,
    successRootId: typeof flow.successRootId === "string" ? flow.successRootId : undefined,
    routes,
    edges,
  };
}

export function parseFlowManifest(raw: string): FlowManifest {
  const parsed = JSON.parse(raw) as Partial<FlowManifest>;
  if ((parsed.version === 1 || parsed.version === 2) && Array.isArray(parsed.flows)) {
    return {
      version: 2,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
      flows: parsed.flows.flatMap((flow) => {
        const normalized = normalizeFlow(flow);
        return normalized ? [normalized] : [];
      }),
    };
  }
  return emptyFlowManifest();
}

export function serializeFlowManifest(manifest: FlowManifest, updatedAt = new Date().toISOString()) {
  const next: FlowManifest = {
    version: 2,
    updatedAt,
    flows: manifest.flows.flatMap((flow) => {
      const normalized = normalizeFlow(flow);
      return normalized ? [normalized] : [];
    }),
  };
  return { manifest: next, json: `${JSON.stringify(next, null, 2)}\n` };
}

export function parseGitStatus(repoPath: string, stdout: string): GitStatus {
  const lines = stdout.split("\n").filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("## ")) ?? "##";
  const files: GitFileStatus[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) continue;
    const index = line[0] ?? " ";
    const workingTree = line[1] ?? " ";
    const rawPath = line.slice(3);
    const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() ?? rawPath : rawPath;
    files.push({ path, index, workingTree });
  }
  return {
    repoPath,
    branch: branchLine.replace(/^##\s*/, ""),
    clean: files.length === 0,
    files,
  };
}
