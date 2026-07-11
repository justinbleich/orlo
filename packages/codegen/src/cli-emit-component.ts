import { readFile } from "node:fs/promises";
import type {
  ComponentDefinition,
  ComponentRegistry,
  TokenRegistry,
} from "@rn-canvas/document";
import { emitComponent } from "./emit-component";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: cli-emit-component <input.json>");

const input = JSON.parse(await readFile(inputPath, "utf8")) as {
  definition: ComponentDefinition;
  components?: ComponentRegistry;
  tokens?: TokenRegistry;
};

process.stdout.write(
  JSON.stringify(emitComponent(input.definition, input.components, input.tokens)),
);
