import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import {
  emptyFlowManifest,
  parseFlowManifest,
  parseGitStatus,
  pathInRoot,
  resolveExternalSourcePath,
  resolveSidecarPath,
  resolveTargetPath,
  serializeFlowManifest,
} from "./repo-contract";

const repo = "/tmp/rn-canvas-repo";

test("pathInRoot accepts descendants and rejects sibling prefix escapes", () => {
  assert.equal(pathInRoot(repo, join(repo, "src", "Screen.tsx")), true);
  assert.equal(pathInRoot(repo, repo), true);
  assert.equal(pathInRoot(repo, "/tmp/rn-canvas-repo-evil/Screen.tsx"), false);
  assert.equal(pathInRoot(repo, "/tmp/Screen.tsx"), false);
});

test("resolveTargetPath defaults beside generated screen and rejects unsafe targets", () => {
  assert.deepEqual(resolveTargetPath(repo, "Profile"), {
    tsxPath: join(repo, "generated", "Profile.tsx"),
    sidecarPath: join(repo, "generated", "Profile.rncanvas.json"),
  });
  assert.deepEqual(resolveTargetPath(repo, "Ignored", "app/Home.tsx"), {
    tsxPath: join(repo, "app", "Home.tsx"),
    sidecarPath: join(repo, "app", "Home.rncanvas.json"),
  });
  assert.throws(() => resolveTargetPath(repo, "Unsafe", "../Unsafe.tsx"), /inside/);
  assert.throws(() => resolveTargetPath(repo, "BadExt", "generated/BadExt.jsx"), /must end in \.tsx/);
});

test("sidecar and source resolvers enforce repo ownership and extensions", () => {
  assert.equal(
    resolveSidecarPath(repo, "app/Home.rncanvas.json"),
    join(repo, "app", "Home.rncanvas.json"),
  );
  assert.equal(resolveExternalSourcePath(repo, "app/Home.jsx"), join(repo, "app", "Home.jsx"));
  assert.throws(() => resolveSidecarPath(repo, "../Home.rncanvas.json"), /inside/);
  assert.throws(() => resolveSidecarPath(repo, "app/Home.json"), /rncanvas\.json/);
  assert.throws(() => resolveExternalSourcePath(repo, "app/Home.ts"), /tsx or \.jsx/);
});

test("flow manifests fall back safely and serialize only the contract fields", () => {
  assert.deepEqual(parseFlowManifest("{\"version\":2,\"flows\":[]}"), emptyFlowManifest());
  const { manifest, json } = serializeFlowManifest(
    {
      version: 1,
      flows: [
        {
          id: "onboarding",
          label: "Onboarding",
          routes: [{ rootId: "root", name: "Start" }],
        },
      ],
    },
    "2026-06-29T00:00:00.000Z",
  );
  assert.equal(manifest.updatedAt, "2026-06-29T00:00:00.000Z");
  assert.match(json, /"updatedAt": "2026-06-29T00:00:00.000Z"/);
  assert.match(json, /"routes"/);
});

test("parseGitStatus preserves branch metadata and normalizes renamed paths", () => {
  const status = parseGitStatus(
    repo,
    [
      "## feature/git...origin/feature/git [ahead 1]",
      " M app/Home.tsx",
      "R  old/Screen.tsx -> app/Screen.tsx",
      "?? app/New.tsx",
      "",
    ].join("\n"),
  );
  assert.equal(status.repoPath, repo);
  assert.equal(status.branch, "feature/git...origin/feature/git [ahead 1]");
  assert.equal(status.clean, false);
  assert.deepEqual(status.files, [
    { path: "app/Home.tsx", index: " ", workingTree: "M" },
    { path: "app/Screen.tsx", index: "R", workingTree: " " },
    { path: "app/New.tsx", index: "?", workingTree: "?" },
  ]);
});
