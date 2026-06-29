import type { Plugin } from "vite";
import type { ComponentRegistry, Node, TokenRegistry } from "@rn-canvas/document";
import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const pluginDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(pluginDir, "../..");
let activeRepoRoot = repoRoot;

type CodegenRequest = {
  root?: Node;
  screenName?: string;
  targetPath?: string;
  components?: ComponentRegistry;
  tokens?: TokenRegistry;
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

type FlowManifest = {
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

type RepoRequest = {
  repoPath?: string;
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

type RepoFlowCandidate = {
  id: string;
  label: string;
  description: string;
  routeKind: RepoScreenCandidate["routeKind"];
  screenPaths: string[];
};

type RepoSidecarCandidate = {
  path: string;
  screenName?: string;
  targetPath?: string;
};

type RepoAssetCandidate = {
  path: string;
  kind: "image" | "font" | "lottie" | "other";
};

type RepoContext = {
  repoPath: string;
  repoName: string;
  packageManager: "pnpm" | "yarn" | "npm" | "unknown";
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

type GitFileStatus = {
  path: string;
  index: string;
  workingTree: string;
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
  const name = input.replace(/[^A-Za-z0-9_$]/g, "");
  return /^[A-Z][A-Za-z0-9_$]*$/.test(name) ? name : "Screen";
}

function pathInRoot(root: string, path: string) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
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
  const root = activeRepoRoot;
  const base = targetPath?.trim()
    ? isAbsolute(targetPath)
      ? targetPath
      : join(root, targetPath)
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

function resolveSidecarPath(input?: string) {
  if (!input?.trim()) throw new Error("Enter a sidecar path");
  const root = activeRepoRoot;
  const sidecarPath = resolve(isAbsolute(input) ? input : join(root, input));
  if (!pathInRoot(root, sidecarPath)) {
    throw new Error("Sidecar path must stay inside the connected repository");
  }
  if (!sidecarPath.endsWith(".rncanvas.json")) {
    throw new Error("Sidecar path must end in .rncanvas.json");
  }
  return sidecarPath;
}

function resolveExternalSourcePath(input?: string) {
  if (!input?.trim()) throw new Error("Enter a React Native source path");
  const root = activeRepoRoot;
  const sourcePath = resolve(isAbsolute(input) ? input : join(root, input));
  if (!pathInRoot(root, sourcePath)) {
    throw new Error("Source path must stay inside the connected repository");
  }
  if (![".tsx", ".jsx"].includes(extname(sourcePath))) {
    throw new Error("Source path must end in .tsx or .jsx");
  }
  return sourcePath;
}

async function runCodegen(
  root: Node,
  screenName: string,
  components?: ComponentRegistry,
  tokens?: TokenRegistry,
): Promise<GeneratedScreen> {
  const dir = await mkdtemp(join(tmpdir(), "rncanvas-codegen-"));
  const inputPath = join(dir, "input.json");
  try {
    await writeFile(inputPath, JSON.stringify({ root, screenName, components, tokens }));
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
  const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-b", "-uall"], {
    cwd: root,
    maxBuffer: 1024 * 1024,
  });
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
    repoPath: root,
    branch: branchLine.replace(/^##\s*/, ""),
    clean: files.length === 0,
    files,
  };
}

function flowManifestPath() {
  return join(activeRepoRoot, ".rncanvas", "flows.json");
}

async function readFlowManifest(): Promise<FlowManifest> {
  try {
    const raw = await readFile(flowManifestPath(), "utf8");
    const parsed = JSON.parse(raw) as FlowManifest;
    if (parsed.version === 1 && Array.isArray(parsed.flows)) return parsed;
  } catch {
    // No manifest yet is the normal first-run state.
  }
  return { version: 1, flows: [] };
}

async function writeFlowManifest(manifest: FlowManifest) {
  const path = flowManifestPath();
  await mkdir(dirname(path), { recursive: true });
  const next: FlowManifest = {
    version: 1,
    updatedAt: new Date().toISOString(),
    flows: manifest.flows,
  };
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
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

function inferRepoFlows(screens: RepoScreenCandidate[]): RepoFlowCandidate[] {
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
    };
  });
}

async function maybeReadSidecar(path: string): Promise<RepoSidecarCandidate> {
  try {
    const raw = await readFile(join(activeRepoRoot, path), "utf8");
    const parsed = JSON.parse(raw) as { screenName?: string };
    return {
      path,
      screenName: parsed.screenName,
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

  return {
    repoPath: root,
    repoName: basename(root),
    packageManager: packageManagerFor(rootEntries),
    frameworks,
    dependencies,
    flows: inferRepoFlows(screens),
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
          const generated = await runCodegen(body.root, screenName, body.components, body.tokens);
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
          const generated = await runCodegen(body.root, screenName, body.components, body.tokens);
          const paths = resolveTargetPath(screenName, body.targetPath);
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
          activeRepoRoot = await resolveRepoRoot(await selectFolderPath());
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
          activeRepoRoot = await resolveRepoRoot(body.repoPath);
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

      server.middlewares.use("/api/mcp/command", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "POST required" });
          return;
        }
        try {
          const body = await readRequestJson<{ type?: string; payload?: unknown }>(req);
          if (!body.type) throw new Error("Command type is required");
          const id = String(nextCommandId++);
          commandQueue.push({ id, type: body.type, payload: body.payload ?? {} });
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
        if (!activeClient || now - activeClient.lastSeen > 2_000) {
          activeClient = { id: clientId, lastSeen: now };
        }
        if (activeClient.id !== clientId) {
          res.statusCode = 204;
          res.end();
          return;
        }
        activeClient.lastSeen = now;
        const command = commandQueue.shift();
        if (!command) {
          res.statusCode = 204;
          res.end();
          return;
        }
        sendJson(res, 200, command);
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
