import { readFile } from "node:fs/promises";
import { parseExternalScreen } from "./index";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: tsx src/cli-parse-external.ts <screen.tsx>");
  process.exit(1);
}

try {
  process.stdout.write(
    JSON.stringify(parseExternalScreen(await readFile(inputPath, "utf8"))),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
