import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkRepoFiles } from "../vite-sim-plugin";

async function withFixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "repo-scan-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("walkRepoFiles scans plain directories but not nested package roots", async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, "package.json"), "{}");
    await mkdir(join(root, "generated"));
    await writeFile(join(root, "generated", "Screen.tsx"), "export default null;");
    await mkdir(join(root, "app", "onboarding"), { recursive: true });
    await writeFile(join(root, "app", "onboarding", "index.tsx"), "export default null;");
    // Nested projects: their own package.json or .git marks a boundary.
    await mkdir(join(root, "examples", "demo", "app"), { recursive: true });
    await writeFile(join(root, "examples", "demo", "package.json"), "{}");
    await writeFile(join(root, "examples", "demo", "app", "index.tsx"), "export default null;");
    await mkdir(join(root, "vendored", "lib", ".git"), { recursive: true });
    await writeFile(join(root, "vendored", "lib", "Screen.tsx"), "export default null;");

    const { files } = await walkRepoFiles(root);
    const sorted = [...files].sort();
    assert.deepEqual(sorted, [
      "app/onboarding/index.tsx",
      "generated/Screen.tsx",
      "package.json",
    ]);
  });
});
