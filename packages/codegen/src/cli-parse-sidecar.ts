import { readFile } from "node:fs/promises";
import { parseSidecar } from "./index";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: tsx src/cli-parse-sidecar.ts <document.rncanvas.json>");
  process.exit(1);
}

try {
  process.stdout.write(JSON.stringify(parseSidecar(await readFile(inputPath, "utf8"))));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
