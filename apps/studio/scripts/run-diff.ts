import { captureSimulatorScreenshot, defaultScreenshotPath } from "@rn-canvas/sim-bridge";
import { computePixelDiff, registerAndDiff } from "@rn-canvas/render-web";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";

async function loadPng(path: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const buffer = await readFile(path);
  const png = PNG.sync.read(buffer);
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data.buffer),
  };
}

const canvasPath = process.argv[2];
const simPath = process.argv[3] ?? defaultScreenshotPath(process.cwd());

if (!canvasPath) {
  console.error("Usage: pnpm diff <canvas-png> [sim-png]");
  process.exit(1);
}

try {
  if (process.argv[3] === undefined) {
    await captureSimulatorScreenshot(simPath);
    console.log(`Captured simulator screenshot → ${simPath}`);
  }

  const [canvas, sim] = await Promise.all([loadPng(canvasPath), loadPng(simPath)]);
  // Crop both to the card and resample to a shared size before diffing — the
  // canvas snapshot is a tight crop, the sim screenshot a full device screen.
  const result = registerAndDiff(canvas, sim, computePixelDiff);

  console.log(
    `Fidelity (card-registered): ${(result.score * 100).toFixed(2)}% ` +
      `(${result.diffPixels}/${result.totalPixels} pixels differ over ${result.width}×${result.height})`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
