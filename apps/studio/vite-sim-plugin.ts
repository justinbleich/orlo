import type { Plugin } from "vite";
import type { ComponentRegistry, Node, TokenRegistry } from "@rn-canvas/document";
import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  displayBranchName,
  emptyFlowManifest,
  parseFlowManifest,
  parseGitStatus,
  pathInRoot,
  resolveExternalSourcePath as resolveExternalSourcePathInRoot,
  resolveSidecarPath as resolveSidecarPathInRoot,
  resolveTargetPath as resolveTargetPathInRoot,
  serializeFlowManifest,
  studioBranchName,
  type FlowManifest,
} from "./src/repo-contract";
import { inferRepoFlowsFromNavigation, type RepoFlowGraphCandidate } from "./nav-graph";

const execFileAsync = promisify(execFile);
const pluginDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(pluginDir, "../..");
const demoRepoRoot = join(repoRoot, "examples", "studio-demo");
let activeRepoRoot = repoRoot;

type CodegenRequest = {
  root?: Node;
  screenName?: string;
  targetPath?: string;
  ifAbsent?: boolean;
  components?: ComponentRegistry;
  tokens?: TokenRegistry;
  navTargets?: Record<string, string>;
};

type GeneratedComponent = {
  name: string;
  fileName: string;
  code: string;
};

type GeneratedTheme = { fileName: string; code: string };

type SidecarRequest = {
  sidecarPath?: string;
};

type ExternalSourceRequest = {
  sourcePath?: string;
};

type TokensSaveRequest = {
  sidecarPath?: string;
  tokens?: TokenRegistry;
};

type FlowManifestRequest = {
  manifest?: FlowManifest;
};

type FlowApplyRequest = {
  operation?: "add-edge";
  sourcePath?: string;
  targetPath?: string;
  anchorNodeId?: string;
  root?: Node;
  screenName?: string;
  components?: ComponentRegistry;
  tokens?: TokenRegistry;
};

type RepoRequest = {
  repoPath?: string;
};

type RepoDesignSession = {
  mode: "current-branch" | "studio-branch";
  branch: string;
  suggestedBranch: string;
  syncTarget: string;
  worktreePath: string;
};

type RepoFramework = {
  id: "expo" | "react-native" | "expo-router" | "react-navigation";
  label: string;
  detail?: string;
};

type RepoScreenCandidate = {
  path: string;
  name: string;
  kind: "source" | "sidecar";
  sidecarPath?: string;
  routeKind: "expo-router" | "react-navigation" | "unknown";
  rnCanvas: boolean;
};

type RepoFlowCandidate = RepoFlowGraphCandidate & {
  id: string;
  label: string;
  description: string;
  routeKind: RepoScreenCandidate["routeKind"];
  screenPaths: string[];
};

type RepoSidecarCandidate = {
  path: string;
  screenName?: string;
  rootId?: string;
  targetPath?: string;
};

type RepoAssetCandidate = {
  path: string;
  kind: "image" | "font" | "lottie" | "other";
};

type RepoContext = {
  repoPath: string;
  repoName: string;
  gitRootPath: string;
  gitRootName: string;
  packageManager: "pnpm" | "yarn" | "npm" | "unknown";
  designSession: RepoDesignSession;
  frameworks: RepoFramework[];
  dependencies: Record<string, string>;
  flows: RepoFlowCandidate[];
  screens: RepoScreenCandidate[];
  sidecars: RepoSidecarCandidate[];
  assets: RepoAssetCandidate[];
  entrypoints: string[];
  ignored: { directories: string[] };
  truncated: boolean;
};

type BrowserCommand = {
  id: string;
  type: string;
  payload: unknown;
};

type BrowserCommandResult = {
  id?: string;
  ok?: boolean;
  value?: unknown;
  error?: string;
};

type GeneratedScreen = {
  screenName: string;
  code: string;
  sidecar: string;
  components: GeneratedComponent[];
  theme?: GeneratedTheme;
};

function readRequestJson<T>(req: import("node:http").IncomingMessage): Promise<T> {
  return new Promise((resolveBody, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolveBody((raw ? JSON.parse(raw) : {}) as T);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: import("node:http").ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function safeComponentName(input = "Screen") {
  return input.trim() || "Screen";
}

async function resolveRepoRoot(input?: string) {
  if (!input?.trim()) throw new Error("Enter a repository path");
  const root = resolve(isAbsolute(input) ? input : join(repoRoot, input));
  await access(root);
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
    cwd: root,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function selectFolderPath() {
  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "Select a React Native repository")',
    ], { maxBuffer: 1024 * 1024 });
    return stdout.trim().replace(/\/$/, "");
  }
  throw new Error("Folder selection is not available in this host. Paste a repository path instead.");
}

function resolveTargetPath(screenName: string, targetPath?: string) {
  return resolveTargetPathInRoot(activeRepoRoot, screenName, targetPath);
}

function resolveSidecarPath(input?: string) {
  return resolveSidecarPathInRoot(activeRepoRoot, input);
}

function resolveExternalSourcePath(input?: string) {
  return resolveExternalSourcePathInRoot(activeRepoRoot, input);
}

async function runCodegen(
  root: Node,
  screenName: string,
  components?: ComponentRegistry,
  tokens?: TokenRegistry,
  navTargets?: Record<string, string>,
): Promise<GeneratedScreen> {
  const dir = await mkdtemp(join(tmpdir(), "rncanvas-codegen-"));
  const inputPath = join(dir, "input.json");
  try {
    await writeFile(inputPath, JSON.stringify({ root, screenName, components, tokens, navTargets }));
    const { stdout } = await execFileAsync("pnpm", [
      "--filter",
      "@rn-canvas/codegen",
      "exec",
      "tsx",
      "src/cli-generate.ts",
      inputPath,
    ], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout) as GeneratedScreen;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function openDocument(sidecarPath: string) {
  // The canonical token values live in `theme.ts` beside the sidecar (Phase 2D-2b).
  // Pass it only when present so pre-2D-2b documents fall back to sidecar tokens.
  const themePath = join(dirname(sidecarPath), "theme.ts");
  const args = ["src/cli-open-document.ts", sidecarPath];
  if (await fileExists(themePath)) args.push(themePath);
  const { stdout } = await execFileAsync("pnpm", [
    "--filter",
    "@rn-canvas/codegen",
    "exec",
    "tsx",
    ...args,
  ], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout) as {
    screenName: string;
    root: Node;
    components?: ComponentRegistry;
    tokens: TokenRegistry;
  };
}

async function emitThemeCode(tokens: TokenRegistry): Promise<GeneratedTheme> {
  const dir = await mkdtemp(join(tmpdir(), "rncanvas-theme-"));
  const inputPath = join(dir, "tokens.json");
  try {
    await writeFile(inputPath, JSON.stringify(tokens));
    const { stdout } = await execFileAsync("pnpm", [
      "--filter",
      "@rn-canvas/codegen",
      "exec",
      "tsx",
      "src/cli-emit-theme.ts",
      inputPath,
    ], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout) as GeneratedTheme;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function parseExternalSource(sourcePath: string) {
  const { stdout } = await execFileAsync("pnpm", [
    "--filter",
    "@rn-canvas/codegen",
    "exec",
    "tsx",
    "src/cli-parse-external.ts",
    sourcePath,
  ], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout) as { screenName: string; root: Node };
}

async function readGitStatus() {
  const root = activeRepoRoot;
  const gitRoot = await resolveGitRoot(root);
  const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-b", "-uall"], {
    cwd: gitRoot,
    maxBuffer: 1024 * 1024,
  });
  const status = parseGitStatus(root, stdout);
  if (resolve(gitRoot) === resolve(root)) return status;

  const rootPrefix = relative(gitRoot, root).split(sep).join("/");
  const files = status.files
    .filter((file) => file.path === rootPrefix || file.path.startsWith(`${rootPrefix}/`))
    .map((file) => ({
      ...file,
      path: file.path === rootPrefix ? basename(root) : file.path.slice(rootPrefix.length + 1),
    }));
  return { ...status, clean: files.length === 0, files };
}

async function resolveGitRoot(root: string) {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
    cwd: root,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function readDesignSession(root: string): Promise<RepoDesignSession> {
  const { branch } = await readGitStatus();
  const branchName = displayBranchName(branch);
  const studioBranch = studioBranchName(root);
  const onStudioBranch = branchName.startsWith("studio/");

  return {
    mode: onStudioBranch ? "studio-branch" : "current-branch",
    branch: branchName,
    suggestedBranch: onStudioBranch ? branchName : studioBranch,
    syncTarget: branchName === "detached" ? "detached worktree" : branchName,
    worktreePath: root,
  };
}

async function gitBranchExists(root: string, branch: string) {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd: root,
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureStudioBranch(root: string) {
  const status = await readGitStatus();
  const currentBranch = displayBranchName(status.branch);
  if (currentBranch.startsWith("studio/")) return currentBranch;

  const branch = studioBranchName(root);
  const args = (await gitBranchExists(root, branch))
    ? ["switch", branch]
    : ["switch", "-c", branch];
  try {
    await execFileAsync("git", args, { cwd: root, maxBuffer: 1024 * 1024 });
  } catch (error) {
    throw new Error(
      `Could not open Studio branch ${branch}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return branch;
}

/** Contents of a repo-relative path at HEAD (the diff baseline). Missing = new file. */
async function readHeadFile(repoRelPath: string) {
  const root = activeRepoRoot;
  const gitRoot = await resolveGitRoot(root);
  const gitRel = relative(gitRoot, resolve(root, repoRelPath)).split(sep).join("/");
  try {
    const { stdout } = await execFileAsync("git", ["show", `HEAD:${gitRel}`], {
      cwd: gitRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { content: stdout, exists: true };
  } catch {
    return { content: "", exists: false };
  }
}

async function listBranches() {
  const gitRoot = await resolveGitRoot(activeRepoRoot);
  const { stdout } = await execFileAsync(
    "git",
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    { cwd: gitRoot, maxBuffer: 1024 * 1024 },
  );
  const branches = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  const status = await readGitStatus();
  return { current: displayBranchName(status.branch), branches };
}

async function switchBranch(branch: string, create: boolean) {
  if (!branch?.trim()) throw new Error("Branch name required");
  const gitRoot = await resolveGitRoot(activeRepoRoot);
  const args = create ? ["switch", "-c", branch] : ["switch", branch];
  await execFileAsync("git", args, { cwd: gitRoot, maxBuffer: 1024 * 1024 });
  return readGitStatus();
}

async function commitPaths(message: string, paths: string[]) {
  const root = activeRepoRoot;
  const gitRoot = await resolveGitRoot(root);
  const absPaths = paths.filter(Boolean).map((path) => resolve(root, path));
  const addArgs = absPaths.length > 0 ? ["add", "--", ...absPaths] : ["add", "-A", "--", root];
  await execFileAsync("git", addArgs, { cwd: gitRoot, maxBuffer: 1024 * 1024 });
  await execFileAsync("git", ["commit", "-m", message.trim() || "Update design"], {
    cwd: gitRoot,
    maxBuffer: 1024 * 1024,
  });
  return readGitStatus();
}

/** GitHub compare URL for the current branch, if an origin remote exists. */
async function remoteCompareUrl() {
  const gitRoot = await resolveGitRoot(activeRepoRoot);
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
      cwd: gitRoot,
      maxBuffer: 1024 * 1024,
    });
    const status = await readGitStatus();
    const branch = displayBranchName(status.branch);
    const httpsUrl = stdout
      .trim()
      .replace(/^git@([^:]+):/, "https://$1/")
      .replace(/\.git$/, "");
    return { url: `${httpsUrl}/compare/${encodeURIComponent(branch)}?expand=1`, branch };
  } catch {
    return { url: null, branch: null };
  }
}

async function connectRepoRoot(path?: string) {
  activeRepoRoot = await resolveRepoRoot(path);
  await ensureStudioBranch(activeRepoRoot);
  return activeRepoRoot;
}

async function connectDemoRepoRoot() {
  await access(demoRepoRoot);
  activeRepoRoot = demoRepoRoot;
  return activeRepoRoot;
}

function flowManifestPath() {
  return join(activeRepoRoot, ".rncanvas", "flows.json");
}

async function readFlowManifest(): Promise<FlowManifest> {
  try {
    const raw = await readFile(flowManifestPath(), "utf8");
    return parseFlowManifest(raw);
  } catch {
    // No manifest yet is the normal first-run state.
  }
  return emptyFlowManifest();
}

async function writeFlowManifest(manifest: FlowManifest) {
  const path = flowManifestPath();
  await mkdir(dirname(path), { recursive: true });
  const next = serializeFlowManifest(manifest);
  await writeFile(path, next.json);
  return next.manifest;
}

// --- Canvas layout manifest (.rncanvas/canvas.json) ---------------------------
// Workspace-spatial state: where each screen frame sits on the infinite canvas.
// Kept out of per-screen sidecars deliberately — arrangement is a workspace
// concern, not part of any one screen's artifact.

type CanvasManifest = {
  version: 1;
  positions: Record<string, { x: number; y: number }>;
  flowPositions?: Record<string, Record<string, { x: number; y: number }>>;
};

function canvasManifestPath() {
  return join(activeRepoRoot, ".rncanvas", "canvas.json");
}

async function readCanvasManifest(): Promise<CanvasManifest> {
  try {
    const raw = await readFile(canvasManifestPath(), "utf8");
    const data = JSON.parse(raw) as CanvasManifest;
    if (data && data.version === 1 && typeof data.positions === "object" && data.positions) {
      const positions: CanvasManifest["positions"] = {};
      for (const [rootId, position] of Object.entries(data.positions)) {
        if (
          position &&
          typeof position.x === "number" &&
          Number.isFinite(position.x) &&
          typeof position.y === "number" &&
          Number.isFinite(position.y)
        ) {
          positions[rootId] = { x: position.x, y: position.y };
        }
      }
      const flowPositions: NonNullable<CanvasManifest["flowPositions"]> = {};
      if (data.flowPositions && typeof data.flowPositions === "object") {
        for (const [flowId, byRoot] of Object.entries(data.flowPositions)) {
          if (!byRoot || typeof byRoot !== "object") continue;
          const normalized: Record<string, { x: number; y: number }> = {};
          for (const [rootId, position] of Object.entries(byRoot)) {
            if (
              position &&
              typeof position.x === "number" &&
              Number.isFinite(position.x) &&
              typeof position.y === "number" &&
              Number.isFinite(position.y)
            ) {
              normalized[rootId] = { x: position.x, y: position.y };
            }
          }
          flowPositions[flowId] = normalized;
        }
      }
      return { version: 1, positions, flowPositions };
    }
  } catch {
    // No manifest yet is the normal first-run state.
  }
  return { version: 1, positions: {} };
}

async function writeCanvasManifest(manifest: CanvasManifest): Promise<CanvasManifest> {
  const path = canvasManifestPath();
  await mkdir(dirname(path), { recursive: true });
  const normalized: CanvasManifest = {
    version: 1,
    positions: manifest.positions ?? {},
    flowPositions: manifest.flowPositions ?? {},
  };
  await writeFile(path, JSON.stringify(normalized, null, 2) + "\n");
  return normalized;
}

const repoScanIgnoredDirs = new Set([
  ".git",
  ".next",
  ".turbo",
  ".expo",
  ".vercel",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "Pods",
  "DerivedData",
]);

const sourceExts = new Set([".tsx", ".jsx"]);
const assetExts = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".ttf",
  ".otf",
  ".json",
]);

function packageManagerFor(files: Set<string>): RepoContext["packageManager"] {
  if (files.has("pnpm-lock.yaml")) return "pnpm";
  if (files.has("yarn.lock")) return "yarn";
  if (files.has("package-lock.json")) return "npm";
  return "unknown";
}

async function readPackageDependencies(root: string) {
  try {
    const raw = await readFile(join(root, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    return {};
  }
}

function routeKindForPath(path: string, dependencies: Record<string, string>) {
  if (/^(app|src\/app)\//.test(path)) return "expo-router";
  if (Object.keys(dependencies).some((dep) => dep.startsWith("@react-navigation/"))) {
    return "react-navigation";
  }
  if (dependencies["expo-router"]) return "expo-router";
  return "unknown";
}

function isLikelyScreenSource(path: string) {
  if (!sourceExts.has(extname(path))) return false;
  if (/(^|\/)_layout\.[tj]sx$/.test(path)) return false;
  if (/\.(test|spec|stories)\.[tj]sx$/.test(path)) return false;
  if (/(^|\/)__tests__(\/|$)/.test(path)) return false;
  if (/(^|\/)(components|ui|tokens|theme)(\/|$)/i.test(path)) return false;
  if (/^(app|src\/app|screens|src\/screens|routes|src\/routes|generated)\//.test(path)) return true;
  if (/(Screen|Route|Page)\.[tj]sx$/.test(path)) return true;
  return /\/(screens|routes)\//.test(path);
}

function screenNameFromPath(path: string) {
  const base = basename(path)
    .replace(/\.rncanvas\.json$/, "")
    .replace(/\.[jt]sx$/, "");
  if (base === "index") {
    const dir = dirname(path);
    if (dir === "app" || dir === "src/app" || dir === ".") return "Home";
    return basename(dir);
  }
  if (base === "_layout") return "Layout";
  return base.replace(/^\[(.+)\]$/, "$1");
}

function titleFromRouteSegment(segment: string) {
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

function routePartsForPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "src" && parts[1] === "app") return parts.slice(2);
  if (parts[0] === "app" || parts[0] === "screens" || parts[0] === "routes") return parts.slice(1);
  if (parts[0] === "src" && (parts[1] === "screens" || parts[1] === "routes")) return parts.slice(2);
  return parts;
}

function expoHrefForPath(path: string) {
  const parts = routePartsForPath(path);
  const last = parts[parts.length - 1];
  if (!last) return "/";
  const base = last.replace(/\.[^.]+$/, "");
  if (base === "_layout" || base.startsWith("+")) return "/";
  const segments = [...parts.slice(0, -1), base]
    .filter((part) => !part.startsWith("("))
    .filter((part) => part !== "index")
    .map((part) => part.replace(/^\[(.+)\]$/, ":$1"));
  return `/${segments.join("/")}`.replace(/\/+$/, "") || "/";
}

function slugId(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "flow";
}

function flowSegmentForScreen(screen: RepoScreenCandidate) {
  const parts = routePartsForPath(screen.path).filter((part) => !part.startsWith("("));
  if (parts.length < 2) return undefined;
  const segment = parts[0];
  if (!segment || segment === "index" || segment === "generated") return undefined;
  return segment;
}

function inferLinearRepoFlows(screens: RepoScreenCandidate[]): RepoFlowCandidate[] {
  // Repo-derived flows are product objects over the current branch, not Studio-only
  // metadata. Mutating one should eventually resolve to route/navigation file changes.
  const groups = new Map<string, RepoScreenCandidate[]>();
  for (const screen of screens) {
    const segment = flowSegmentForScreen(screen);
    if (!segment) continue;
    const group = groups.get(segment) ?? [];
    group.push(screen);
    groups.set(segment, group);
  }
  return [...groups.entries()].map(([segment, screens]) => {
    const label = titleFromRouteSegment(segment);
    const routeKind = screens.find((screen) => screen.routeKind !== "unknown")?.routeKind ?? screens[0]?.routeKind ?? "unknown";
    return {
      id: `repo-flow:${slugId(segment)}`,
      label,
      description: `${label} journey inferred from repo routes.`,
      routeKind,
      screenPaths: screens.map((screen) => screen.path),
      edges: [],
    };
  });
}

async function maybeReadSidecar(path: string): Promise<RepoSidecarCandidate> {
  try {
    const raw = await readFile(join(activeRepoRoot, path), "utf8");
    const parsed = JSON.parse(raw) as { root?: { id?: unknown }; screenName?: string };
    const rootId = typeof parsed.root?.id === "string" ? parsed.root.id : undefined;
    return {
      path,
      screenName: parsed.screenName,
      rootId,
      targetPath: path.replace(/\.rncanvas\.json$/, ".tsx"),
    };
  } catch {
    return { path, targetPath: path.replace(/\.rncanvas\.json$/, ".tsx") };
  }
}

function assetKind(path: string): RepoAssetCandidate["kind"] {
  const ext = extname(path).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(ext)) return "image";
  if ([".ttf", ".otf"].includes(ext)) return "font";
  if (ext === ".json" && /lottie/i.test(path)) return "lottie";
  return "other";
}

async function walkRepoFiles(root: string) {
  const files: string[] = [];
  const rootEntries = new Set<string>();
  let truncated = false;
  const maxFiles = 4_000;
  const maxDepth = 7;

  async function visit(dir: string, depth: number) {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs);
      if (depth === 0) rootEntries.add(entry.name);
      if (entry.isDirectory()) {
        if (repoScanIgnoredDirs.has(entry.name) || depth >= maxDepth) continue;
        await visit(abs, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(rel);
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
    }
  }

  await visit(root, 0);
  return { files, rootEntries, truncated };
}

async function readRepoContext(): Promise<RepoContext> {
  const root = activeRepoRoot;
  const gitRoot = await resolveGitRoot(root);
  const { files, rootEntries, truncated } = await walkRepoFiles(root);
  const dependencies = await readPackageDependencies(root);
  const frameworks: RepoFramework[] = [];
  if (dependencies.expo || files.some((file) => /^app\.(json|config\.)/.test(file))) {
    frameworks.push({ id: "expo", label: "Expo", detail: dependencies.expo });
  }
  if (dependencies["react-native"]) {
    frameworks.push({
      id: "react-native",
      label: "React Native",
      detail: dependencies["react-native"],
    });
  }
  if (dependencies["expo-router"] || files.some((file) => /^(app|src\/app)\//.test(file))) {
    frameworks.push({
      id: "expo-router",
      label: "Expo Router",
      detail: dependencies["expo-router"],
    });
  }
  const reactNavigationDeps = Object.keys(dependencies).filter((dep) =>
    dep.startsWith("@react-navigation/"),
  );
  if (reactNavigationDeps.length > 0) {
    frameworks.push({
      id: "react-navigation",
      label: "React Navigation",
      detail: reactNavigationDeps.slice(0, 2).join(", "),
    });
  }

  const sidecars = await Promise.all(
    files.filter((file) => file.endsWith(".rncanvas.json")).map((file) => maybeReadSidecar(file)),
  );
  const sidecarByTarget = new Map(
    sidecars
      .filter((sidecar): sidecar is RepoSidecarCandidate & { targetPath: string } => !!sidecar.targetPath)
      .map((sidecar) => [sidecar.targetPath, sidecar]),
  );
  const screenMap = new Map<string, RepoScreenCandidate>();
  for (const file of files) {
    if (isLikelyScreenSource(file)) {
      const sidecar = sidecarByTarget.get(file);
      screenMap.set(file, {
        path: file,
        name: sidecar?.screenName ?? screenNameFromPath(file),
        kind: "source",
        sidecarPath: sidecar?.path,
        routeKind: routeKindForPath(file, dependencies),
        rnCanvas: !!sidecar,
      });
    }
  }
  for (const sidecar of sidecars) {
    if (sidecar.targetPath && !screenMap.has(sidecar.targetPath)) {
      screenMap.set(sidecar.path, {
        path: sidecar.path,
        name: sidecar.screenName ?? screenNameFromPath(sidecar.path),
        kind: "sidecar",
        sidecarPath: sidecar.path,
        routeKind: routeKindForPath(sidecar.path, dependencies),
        rnCanvas: true,
      });
    }
  }

  const entrypoints = files.filter((file) =>
    /^(App\.[tj]sx|app\/_layout\.[tj]sx|src\/app\/_layout\.[tj]sx|index\.[jt]s|main\.[tj]sx)$/.test(
      file,
    ),
  );
  const assets = files
    .filter((file) => assetExts.has(extname(file).toLowerCase()))
    .filter((file) => /(^|\/)(assets|public|images|fonts|lottie)(\/|$)/i.test(file))
    .slice(0, 80)
    .map((file) => ({ path: file, kind: assetKind(file) }));

  const screens = [...screenMap.values()].slice(0, 80);
  const extractedFlows = await inferRepoFlowsFromNavigation(root, screens, sidecars);
  const flows = extractedFlows.length > 0 ? extractedFlows : inferLinearRepoFlows(screens);

  return {
    repoPath: root,
    repoName: basename(root),
    gitRootPath: gitRoot,
    gitRootName: basename(gitRoot),
    packageManager: packageManagerFor(rootEntries),
    designSession: await readDesignSession(root),
    frameworks,
    dependencies,
    flows,
    screens,
    sidecars,
    assets,
    entrypoints,
    ignored: { directories: [...repoScanIgnoredDirs].sort() },
    truncated,
  };
}

export function simScreenshotPlugin(): Plugin {
  const commandQueue: BrowserCommand[] = [];
  const pending = new Map<
    string,
    { res: import("node:http").ServerResponse; timeout: ReturnType<typeof setTimeout> }
  >();
  let nextCommandId = 1;
  let activeClient: { id: string; lastSeen: number } | null = null;
  // The active client's parked long-poll, when its queue was empty. Held open for
  // LONG_POLL_MS so an idle bridge costs ~2 requests a minute instead of 10/s.
  let commandWaiter: {
    res: import("node:http").ServerResponse;
    timeout: ReturnType<typeof setTimeout>;
  } | null = null;
  const LONG_POLL_MS = 25_000;

  function browserBridgeActive(now = Date.now()) {
    // A parked long-poll is proof the client is connected even though its
    // lastSeen predates the park.
    if (commandWaiter) return true;
    return !!activeClient && now - activeClient.lastSeen <= 2_000;
  }

  /** Answer the parked long-poll (with the next command, or 204 on timeout). */
  function resolveCommandWaiter(command: BrowserCommand | null) {
    if (!commandWaiter) return;
    const { res, timeout } = commandWaiter;
    commandWaiter = null;
    clearTimeout(timeout);
    if (activeClient) activeClient.lastSeen = Date.now();
    if (command) {
      sendJson(res, 200, command);
    } else {
      res.statusCode = 204;
      res.end();
    }
  }

  return {
    name: "studio-node-api",
    configureServer(server) {
      server.middlewares.use("/api/codegen/preview", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "POST required" });
          return;
        }
        try {
          const body = await readRequestJson<CodegenRequest>(req);
          if (!body.root) throw new Error("Missing document root");
          const screenName = safeComponentName(body.screenName);
          const generated = await runCodegen(body.root, screenName, body.components, body.tokens, body.navTargets);
          const paths = resolveTargetPath(screenName, body.targetPath);
          sendJson(res, 200, {
            ...generated,
            repoPath: activeRepoRoot,
            targetPath: relative(activeRepoRoot, paths.tsxPath),
            sidecarPath: relative(activeRepoRoot, paths.sidecarPath),
          });
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Codegen preview failed",
          });
        }
      });

      server.middlewares.use("/api/codegen/sync", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "POST required" });
          return;
        }
        try {
          const body = await readRequestJson<CodegenRequest>(req);
          if (!body.root) throw new Error("Missing document root");
          const screenName = safeComponentName(body.screenName);
          const generated = await runCodegen(body.root, screenName, body.components, body.tokens, body.navTargets);
          const paths = resolveTargetPath(screenName, body.targetPath);
          if (body.ifAbsent && ((await fileExists(paths.tsxPath)) || (await fileExists(paths.sidecarPath)))) {
            throw new Error("Screen path already exists");
          }
          const exportDir = dirname(paths.tsxPath);
          await mkdir(exportDir, { recursive: true });
          await writeFile(paths.tsxPath, `${generated.code}\n`);
          await writeFile(paths.sidecarPath, `${generated.sidecar}\n`);
          // Write each used component as its own module beside the screen.
          const componentPaths: string[] = [];
          if (generated.components.length > 0) {
            const componentsDir = join(exportDir, "components");
            await mkdir(componentsDir, { recursive: true });
            for (const component of generated.components) {
              const filePath = join(componentsDir, component.fileName);
              await writeFile(filePath, `${component.code}\n`);
              componentPaths.push(relative(activeRepoRoot, filePath));
            }
          }
          // Write the shared theme module at the export root (next to the screen).
          let themePath: string | undefined;
          if (generated.theme) {
            const filePath = join(exportDir, generated.theme.fileName);
            await writeFile(filePath, `${generated.theme.code}\n`);
            themePath = relative(activeRepoRoot, filePath);
          }
          sendJson(res, 200, {
            ...generated,
            repoPath: activeRepoRoot,
            targetPath: relative(activeRepoRoot, paths.tsxPath),
            sidecarPath: relative(activeRepoRoot, paths.sidecarPath),
            componentPaths,
            themePath,
            wrote: true,
          });
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Codegen sync failed",
          });
        }
      });

      server.middlewares.use("/api/flows/apply", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "POST required" });
          return;
        }
        try {
          const body = await readRequestJson<FlowApplyRequest>(req);
          if (body.operation !== "add-edge") throw new Error("Unsupported flow operation");
          if (!body.root) throw new Error("Missing source document root");
          if (!body.anchorNodeId) throw new Error("Missing source anchor node");
          if (!body.sourcePath || !body.targetPath) throw new Error("Missing source or target path");
          const sourcePath = resolveExternalSourcePath(body.sourcePath);
          const screenName = safeComponentName(body.screenName);
          const generated = await runCodegen(body.root, screenName, body.components, body.tokens, {
            [body.anchorNodeId]: expoHrefForPath(body.targetPath),
          });
          const sourceDir = dirname(sourcePath);
          await mkdir(sourceDir, { recursive: true });
          await writeFile(sourcePath, `${generated.code}\n`);
          await writeFile(sourcePath.replace(/\.tsx$/, ".rncanvas.json"), `${generated.sidecar}\n`);
          const componentPaths: string[] = [];
          if (generated.components.length > 0) {
            const componentsDir = join(sourceDir, "components");
            await mkdir(componentsDir, { recursive: true });
            for (const component of generated.components) {
              const filePath = join(componentsDir, component.fileName);
              await writeFile(filePath, `${component.code}\n`);
              componentPaths.push(relative(activeRepoRoot, filePath));
            }
          }
          let themePath: string | undefined;
          if (generated.theme) {
            const filePath = join(sourceDir, generated.theme.fileName);
            await writeFile(filePath, `${generated.theme.code}\n`);
            themePath = relative(activeRepoRoot, filePath);
          }
          sendJson(res, 200, {
            ...generated,
            repoPath: activeRepoRoot,
            targetPath: relative(activeRepoRoot, sourcePath),
            sidecarPath: relative(activeRepoRoot, sourcePath).replace(/\.tsx$/, ".rncanvas.json"),
            componentPaths,
            themePath,
            wrote: true,
          });
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Flow apply failed",
          });
        }
      });

      server.middlewares.use("/api/documents/open", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "POST required" });
          return;
        }
        try {
          const body = await readRequestJson<SidecarRequest>(req);
          const sidecarPath = resolveSidecarPath(body.sidecarPath);
          const document = await openDocument(sidecarPath);
          sendJson(res, 200, {
            ...document,
            repoPath: activeRepoRoot,
            sidecarPath: relative(activeRepoRoot, sidecarPath),
            targetPath: relative(activeRepoRoot, sidecarPath).replace(/\.rncanvas\.json$/, ".tsx"),
          });
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Sidecar load failed",
          });
        }
      });

      server.middlewares.use("/api/documents/import-code", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "POST required" });
          return;
        }
        try {
          const body = await readRequestJson<ExternalSourceRequest>(req);
          const sourcePath = resolveExternalSourcePath(body.sourcePath);
          const document = await parseExternalSource(sourcePath);
          const relativeSourcePath = relative(activeRepoRoot, sourcePath);
          sendJson(res, 200, {
            ...document,
            repoPath: activeRepoRoot,
            sourcePath: relativeSourcePath,
            sidecarPath: relativeSourcePath.replace(/\.(tsx|jsx)$/, ".rncanvas.json"),
          });
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "React Native import failed",
          });
        }
      });

      // Single-writer canonical token file (Phase 2D-2b). The studio debounces
      // this on token-registry edits; it writes `theme.ts` beside the sidecar and
      // never runs on the canvas interaction path.
      server.middlewares.use("/api/tokens/save", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "POST required" });
          return;
        }
        try {
          const body = await readRequestJson<TokensSaveRequest>(req);
          const sidecarPath = resolveSidecarPath(body.sidecarPath);
          const tokens = body.tokens ?? {};
          const theme = await emitThemeCode(tokens);
          const themePath = join(dirname(sidecarPath), theme.fileName);
          await mkdir(dirname(themePath), { recursive: true });
          await writeFile(themePath, `${theme.code}\n`);
          sendJson(res, 200, { themePath: relative(activeRepoRoot, themePath), wrote: true });
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Token save failed",
          });
        }
      });

      server.middlewares.use("/api/repo/context", async (req, res) => {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "GET required" });
          return;
        }
        try {
          sendJson(res, 200, await readRepoContext());
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Repository scan failed",
          });
        }
      });

      server.middlewares.use("/api/repo/select-folder", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "POST required" });
          return;
        }
        try {
          await connectRepoRoot(await selectFolderPath());
          sendJson(res, 200, {
            repoPath: activeRepoRoot,
            defaultRepoPath: repoRoot,
            git: await readGitStatus(),
            context: await readRepoContext(),
          });
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Folder selection failed",
          });
        }
      });

      server.middlewares.use("/api/repo/demo", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "POST required" });
          return;
        }
        try {
          await connectDemoRepoRoot();
          sendJson(res, 200, {
            repoPath: activeRepoRoot,
            defaultRepoPath: repoRoot,
            demoRepoPath: demoRepoRoot,
            git: await readGitStatus(),
            context: await readRepoContext(),
          });
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Demo repository connection failed",
          });
        }
      });

      server.middlewares.use("/api/repo", async (req, res) => {
        try {
          if (req.method === "GET") {
            sendJson(res, 200, {
              repoPath: activeRepoRoot,
              defaultRepoPath: repoRoot,
              context: await readRepoContext(),
            });
            return;
          }
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "GET or POST required" });
            return;
          }
          const body = await readRequestJson<RepoRequest>(req);
          await connectRepoRoot(body.repoPath);
          sendJson(res, 200, {
            repoPath: activeRepoRoot,
            defaultRepoPath: repoRoot,
            git: await readGitStatus(),
            context: await readRepoContext(),
          });
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Repository connection failed",
          });
        }
      });

      server.middlewares.use("/api/git/status", async (req, res) => {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "GET required" });
          return;
        }
        try {
          sendJson(res, 200, await readGitStatus());
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Git status failed",
          });
        }
      });

      server.middlewares.use("/api/git/head-file", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "POST required" });
          return;
        }
        try {
          const body = await readRequestJson<{ path?: string }>(req);
          if (!body.path) throw new Error("Missing path");
          sendJson(res, 200, await readHeadFile(body.path));
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Git show failed",
          });
        }
      });

      server.middlewares.use("/api/git/branches", async (req, res) => {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "GET required" });
          return;
        }
        try {
          sendJson(res, 200, await listBranches());
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Branch list failed",
          });
        }
      });

      server.middlewares.use("/api/git/switch", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "POST required" });
          return;
        }
        try {
          const body = await readRequestJson<{ branch?: string; create?: boolean }>(req);
          sendJson(res, 200, await switchBranch(body.branch ?? "", Boolean(body.create)));
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Branch switch failed",
          });
        }
      });

      server.middlewares.use("/api/git/commit", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "POST required" });
          return;
        }
        try {
          const body = await readRequestJson<{ message?: string; paths?: string[] }>(req);
          sendJson(res, 200, await commitPaths(body.message ?? "", body.paths ?? []));
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Commit failed",
          });
        }
      });

      server.middlewares.use("/api/git/pr-url", async (req, res) => {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "GET required" });
          return;
        }
        try {
          sendJson(res, 200, await remoteCompareUrl());
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "PR URL failed",
          });
        }
      });

      server.middlewares.use("/api/flows", async (req, res) => {
        try {
          if (req.method === "GET") {
            sendJson(res, 200, await readFlowManifest());
            return;
          }
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "GET or POST required" });
            return;
          }
          const body = await readRequestJson<FlowManifestRequest>(req);
          if (!body.manifest) throw new Error("Missing flow manifest");
          sendJson(res, 200, await writeFlowManifest(body.manifest));
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Flow manifest failed",
          });
        }
      });

      server.middlewares.use("/api/canvas", async (req, res) => {
        try {
          if (req.method === "GET") {
            sendJson(res, 200, await readCanvasManifest());
            return;
          }
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "GET or POST required" });
            return;
          }
          const body = await readRequestJson<{ manifest?: CanvasManifest }>(req);
          if (!body.manifest) throw new Error("Missing canvas manifest");
          sendJson(res, 200, await writeCanvasManifest(body.manifest));
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Canvas manifest failed",
          });
        }
      });

      server.middlewares.use("/api/mcp/command", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "POST required" });
          return;
        }
        try {
          const body = await readRequestJson<{ type?: string; payload?: unknown }>(req);
          if (!body.type) throw new Error("Command type is required");
          if (!browserBridgeActive()) {
            sendJson(res, 503, {
              ok: false,
              error:
                "Studio browser bridge is not connected. Open Studio in a browser before using live MCP tools.",
            });
            return;
          }
          const id = String(nextCommandId++);
          commandQueue.push({ id, type: body.type, payload: body.payload ?? {} });
          // Hand the command straight to a parked long-poll instead of waiting
          // for the next poll cycle.
          if (commandWaiter) resolveCommandWaiter(commandQueue.shift() ?? null);
          const timeout = setTimeout(() => {
            pending.delete(id);
            sendJson(res, 504, {
              ok: false,
              error: "Studio did not answer the command before timeout",
            });
          }, 30_000);
          pending.set(id, { res, timeout });
        } catch (error) {
          sendJson(res, 400, {
            ok: false,
            error: error instanceof Error ? error.message : "Invalid MCP command",
          });
        }
      });

      server.middlewares.use("/api/mcp/status", async (req, res) => {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "GET required" });
          return;
        }
        const now = Date.now();
        const active = browserBridgeActive(now);
        try {
          sendJson(res, 200, {
            ok: true,
            studioUrl: `http://localhost:${server.config.server.port ?? 5173}`,
            repoPath: activeRepoRoot,
            browserBridgeActive: active,
            browserBridgeLastSeenMs: activeClient ? now - activeClient.lastSeen : null,
            queuedCommands: commandQueue.length,
            pendingCommands: pending.size,
            git: await readGitStatus(),
          });
        } catch (error) {
          sendJson(res, 200, {
            ok: true,
            repoPath: activeRepoRoot,
            browserBridgeActive: active,
            browserBridgeLastSeenMs: activeClient ? now - activeClient.lastSeen : null,
            queuedCommands: commandQueue.length,
            pendingCommands: pending.size,
            gitError: error instanceof Error ? error.message : "Git status failed",
          });
        }
      });

      server.middlewares.use("/api/mcp/next", (req, res) => {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "GET required" });
          return;
        }
        const clientId = new URL(req.url ?? "", "http://localhost").searchParams.get(
          "clientId",
        );
        if (!clientId) {
          sendJson(res, 400, { error: "clientId is required" });
          return;
        }
        const now = Date.now();
        // Never take over while the active client has a poll parked — a stale
        // lastSeen during a long-poll doesn't mean the client went away.
        if (!commandWaiter && (!activeClient || now - activeClient.lastSeen > 2_000)) {
          activeClient = { id: clientId, lastSeen: now };
        }
        if (activeClient?.id !== clientId) {
          // A non-active client (e.g. a second tab): answer 204 after a beat so
          // its immediate-reconnect loop doesn't busy-poll the server.
          const timeout = setTimeout(() => {
            res.statusCode = 204;
            res.end();
          }, 1_000);
          res.on("close", () => clearTimeout(timeout));
          return;
        }
        activeClient.lastSeen = now;
        const command = commandQueue.shift();
        if (command) {
          sendJson(res, 200, command);
          return;
        }
        // Empty queue: park this poll until a command arrives or the window ends.
        // A newer poll from the same client (e.g. after a network retry)
        // supersedes the parked one.
        resolveCommandWaiter(null);
        const timeout = setTimeout(() => resolveCommandWaiter(null), LONG_POLL_MS);
        commandWaiter = { res, timeout };
        res.on("close", () => {
          if (commandWaiter?.res === res) {
            clearTimeout(commandWaiter.timeout);
            commandWaiter = null;
          }
        });
      });

      server.middlewares.use("/api/mcp/result", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "POST required" });
          return;
        }
        const result = await readRequestJson<BrowserCommandResult>(req);
        const entry = result.id ? pending.get(result.id) : undefined;
        if (!entry) {
          sendJson(res, 404, { error: "Pending command not found" });
          return;
        }
        clearTimeout(entry.timeout);
        pending.delete(result.id!);
        sendJson(entry.res, result.ok ? 200 : 400, {
          ok: !!result.ok,
          value: result.value,
          error: result.error,
        });
        sendJson(res, 200, { ok: true });
      });
    },
  };
}
