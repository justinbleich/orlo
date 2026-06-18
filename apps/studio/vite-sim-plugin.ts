import type { Plugin } from "vite";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const pluginDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(pluginDir, "../..");
const screenshotPath = join(repoRoot, "tmp", "sim-screenshot.png");

export function simScreenshotPlugin(): Plugin {
  return {
    name: "sim-screenshot-api",
    configureServer(server) {
      server.middlewares.use("/api/sim-screenshot", async (_req, res) => {
        try {
          await execFileAsync("pnpm", [
            "--filter",
            "@rn-canvas/sim-bridge",
            "capture",
            screenshotPath,
          ], { cwd: repoRoot });

          const png = await readFile(screenshotPath);
          res.statusCode = 200;
          res.setHeader("Content-Type", "image/png");
          res.end(png);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Capture failed",
            }),
          );
        }
      });
    },
  };
}
