import { readFile } from "node:fs/promises";
import type { TokenRegistry } from "@rn-canvas/document";
import { emitTheme } from "./index";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: tsx src/cli-emit-theme.ts <tokens.json>");
  process.exit(1);
}

try {
  const tokens = JSON.parse(await readFile(inputPath, "utf8")) as TokenRegistry;
  process.stdout.write(JSON.stringify(emitTheme(tokens)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
