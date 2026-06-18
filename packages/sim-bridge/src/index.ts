import { execFile } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function getBootedSimulatorName(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("xcrun", ["simctl", "list", "devices", "booted"]);
    const match = stdout.match(/^\s+(iPhone[^\n(]+)/m);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export async function bootDefaultSimulator(): Promise<void> {
  const { stdout } = await execFileAsync("xcrun", [
    "simctl",
    "list",
    "devices",
    "available",
  ]);

  const iphoneLine = stdout
    .split("\n")
    .find((line) => line.includes("iPhone") && line.includes("(Shutdown)"));

  if (!iphoneLine) {
    throw new Error("No available iPhone simulator found.");
  }

  const idMatch = iphoneLine.match(/\(([0-9A-F-]{36})\)/i);
  if (!idMatch) {
    throw new Error("Could not parse simulator UDID.");
  }

  await execFileAsync("xcrun", ["simctl", "boot", idMatch[1]]);
}

export async function captureSimulatorScreenshot(
  outputPath: string,
  options: { bootIfNeeded?: boolean } = {},
): Promise<string> {
  const { bootIfNeeded = true } = options;

  let booted = await getBootedSimulatorName();
  if (!booted && bootIfNeeded) {
    await bootDefaultSimulator();
    booted = await getBootedSimulatorName();
  }

  if (!booted) {
    throw new Error(
      "No booted iOS simulator. Boot one manually or run the harness app first.",
    );
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await execFileAsync("xcrun", ["simctl", "io", "booted", "screenshot", outputPath]);

  try {
    await access(outputPath);
  } catch {
    throw new Error(`Screenshot command succeeded but file missing: ${outputPath}`);
  }

  return outputPath;
}

export function defaultScreenshotPath(cwd = process.cwd()): string {
  return join(cwd, "tmp", "sim-screenshot.png");
}
