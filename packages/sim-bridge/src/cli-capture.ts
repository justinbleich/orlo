import { captureSimulatorScreenshot, defaultScreenshotPath } from "./index.js";

const output = process.argv[2] ?? defaultScreenshotPath();

try {
  const path = await captureSimulatorScreenshot(output);
  console.log(`Simulator screenshot saved to ${path}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
