import { readFile } from "node:fs/promises";
import { openDocument } from "./index";

const sidecarPath = process.argv[2];
const themePath = process.argv[3];

if (!sidecarPath) {
  console.error("Usage: tsx src/cli-open-document.ts <document.rncanvas.json> [theme.ts]");
  process.exit(1);
}

try {
  const sidecarJson = await readFile(sidecarPath, "utf8");
  const themeSource = themePath ? await readFile(themePath, "utf8") : undefined;
  process.stdout.write(JSON.stringify(openDocument(sidecarJson, themeSource)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
