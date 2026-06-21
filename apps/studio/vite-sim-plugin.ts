import type { Plugin } from "vite";
import type { Node } from "@rn-canvas/document";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const pluginDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(pluginDir, "../..");
const defaultExportDir = join(repoRoot, "generated");

type CodegenRequest = {
  root?: Node;
  screenName?: string;
  targetPath?: string;
};

type SidecarRequest = {
  sidecarPath?: string;
};

type GeneratedScreen = {
  screenName: string;
  code: string;
  sidecar: string;
};

function readRequestJson(req: import("node:http").IncomingMessage): Promise<CodegenRequest> {
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
        resolveBody(raw ? JSON.parse(raw) : {});
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

function resolveTargetPath(screenName: string, targetPath?: string) {
  const base = targetPath?.trim()
    ? isAbsolute(targetPath)
      ? targetPath
      : join(repoRoot, targetPath)
    : join(defaultExportDir, `${screenName}.tsx`);
  const tsxPath = resolve(base);
  if (relative(repoRoot, tsxPath).startsWith("..")) {
    throw new Error("Sync path must stay inside the workspace");
  }
  if (extname(tsxPath) !== ".tsx") {
    throw new Error("Export path must end in .tsx");
  }
  const sidecarPath = tsxPath.replace(/\.tsx$/, ".rncanvas.json");
  return { tsxPath, sidecarPath };
}

function resolveSidecarPath(input?: string) {
  if (!input?.trim()) throw new Error("Enter a sidecar path");
  const sidecarPath = resolve(isAbsolute(input) ? input : join(repoRoot, input));
  if (relative(repoRoot, sidecarPath).startsWith("..")) {
    throw new Error("Sidecar path must stay inside the workspace");
  }
  if (!sidecarPath.endsWith(".rncanvas.json")) {
    throw new Error("Sidecar path must end in .rncanvas.json");
  }
  return sidecarPath;
}

async function runCodegen(root: Node, screenName: string): Promise<GeneratedScreen> {
  const dir = await mkdtemp(join(tmpdir(), "rncanvas-codegen-"));
  const inputPath = join(dir, "input.json");
  try {
    await writeFile(inputPath, JSON.stringify({ root, screenName }));
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

async function parseSidecar(sidecarPath: string) {
  const { stdout } = await execFileAsync("pnpm", [
    "--filter",
    "@rn-canvas/codegen",
    "exec",
    "tsx",
    "src/cli-parse-sidecar.ts",
    sidecarPath,
  ], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout) as { version: 1; screenName: string; root: Node };
}

export function simScreenshotPlugin(): Plugin {
  return {
    name: "studio-node-api",
    configureServer(server) {
      server.middlewares.use("/api/codegen/preview", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "POST required" });
          return;
        }
        try {
          const body = await readRequestJson(req);
          if (!body.root) throw new Error("Missing document root");
          const screenName = safeComponentName(body.screenName);
          const generated = await runCodegen(body.root, screenName);
          const paths = resolveTargetPath(screenName, body.targetPath);
          sendJson(res, 200, {
            ...generated,
            targetPath: relative(repoRoot, paths.tsxPath),
            sidecarPath: relative(repoRoot, paths.sidecarPath),
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
          const body = await readRequestJson(req);
          if (!body.root) throw new Error("Missing document root");
          const screenName = safeComponentName(body.screenName);
          const generated = await runCodegen(body.root, screenName);
          const paths = resolveTargetPath(screenName, body.targetPath);
          await mkdir(dirname(paths.tsxPath), { recursive: true });
          await writeFile(paths.tsxPath, `${generated.code}\n`);
          await writeFile(paths.sidecarPath, `${generated.sidecar}\n`);
          sendJson(res, 200, {
            ...generated,
            targetPath: relative(repoRoot, paths.tsxPath),
            sidecarPath: relative(repoRoot, paths.sidecarPath),
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
          const body = await readRequestJson(req) as SidecarRequest;
          const sidecarPath = resolveSidecarPath(body.sidecarPath);
          const document = await parseSidecar(sidecarPath);
          sendJson(res, 200, {
            ...document,
            sidecarPath: relative(repoRoot, sidecarPath),
            targetPath: relative(repoRoot, sidecarPath).replace(/\.rncanvas\.json$/, ".tsx"),
          });
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Sidecar load failed",
          });
        }
      });
    },
  };
}
