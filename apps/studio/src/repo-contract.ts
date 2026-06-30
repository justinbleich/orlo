import { extname, isAbsolute, join, relative, resolve } from "node:path";

export type FlowManifest = {
  version: 1;
  updatedAt?: string;
  flows: Array<{
    id: string;
    label: string;
    entryRootId?: string;
    entryName?: string;
    routes: Array<{ rootId: string; name: string }>;
  }>;
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
  return { version: 1, flows: [] };
}

export function parseFlowManifest(raw: string): FlowManifest {
  const parsed = JSON.parse(raw) as FlowManifest;
  if (parsed.version === 1 && Array.isArray(parsed.flows)) return parsed;
  return emptyFlowManifest();
}

export function serializeFlowManifest(manifest: FlowManifest, updatedAt = new Date().toISOString()) {
  const next: FlowManifest = {
    version: 1,
    updatedAt,
    flows: manifest.flows,
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
