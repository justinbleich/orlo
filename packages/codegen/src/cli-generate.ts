import { readFile } from "node:fs/promises";
import type { ComponentRegistry, Node, TokenRegistry } from "@rn-canvas/document";
import { generateScreen } from "./index";

type CliInput = {
  root: Node;
  screenName?: string;
  components?: ComponentRegistry;
  tokens?: TokenRegistry;
};

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: tsx src/cli-generate.ts <input.json>");
  process.exit(1);
}

try {
  const input = JSON.parse(await readFile(inputPath, "utf8")) as CliInput;
  if (!input.root) throw new Error("Missing document root");
  process.stdout.write(JSON.stringify(generateScreen(input.root, {
    screenName: input.screenName,
    components: input.components,
    tokens: input.tokens,
  })));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
