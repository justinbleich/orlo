import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { inferRepoFlowsFromNavigation } from "../nav-graph";

test("expo-router extraction resolves anchored push calls", async () => {
  const repo = await mkdtemp(join(tmpdir(), "rncanvas-nav-graph-"));
  await mkdir(join(repo, "app", "onboarding"), { recursive: true });
  await writeFile(
    join(repo, "app", "onboarding", "index.tsx"),
    `
      import { useRouter } from "expo-router";
      import { Pressable, Text, View } from "react-native";
      export default function Start() {
        const router = useRouter();
        return <View><Pressable onPress={() => router.push("/onboarding/details")}><Text>Next</Text></Pressable></View>;
      }
    `,
  );
  await writeFile(
    join(repo, "app", "onboarding", "details.tsx"),
    `import { Text } from "react-native"; export default function Details() { return <Text>Details</Text>; }`,
  );
  await writeFile(
    join(repo, "app", "onboarding", "index.rncanvas.json"),
    JSON.stringify({
      screenName: "Start",
      root: {
        id: "root",
        type: "View",
        style: {},
        children: [
          {
            id: "cta",
            type: "Pressable",
            style: {},
            children: [{ id: "label", type: "Text", props: { text: "Next" }, style: {} }],
          },
        ],
      },
    }),
  );

  const flows = await inferRepoFlowsFromNavigation(
    repo,
    [
      {
        path: "app/onboarding/index.tsx",
        name: "Start",
        kind: "source",
        sidecarPath: "app/onboarding/index.rncanvas.json",
        routeKind: "expo-router",
        rnCanvas: true,
      },
      {
        path: "app/onboarding/details.tsx",
        name: "Details",
        kind: "source",
        routeKind: "expo-router",
        rnCanvas: false,
      },
    ],
    [{ path: "app/onboarding/index.rncanvas.json", targetPath: "app/onboarding/index.tsx" }],
  );

  assert.equal(flows.length, 1);
  assert.equal(flows[0].id, "repo-flow:onboarding");
  assert.equal(flows[0].entryPath, "app/onboarding/index.tsx");
  assert.deepEqual(flows[0].edges, [
    {
      fromPath: "app/onboarding/index.tsx",
      toPath: "app/onboarding/details.tsx",
      kind: "primary",
      condition: undefined,
      anchorNodeId: "cta",
    },
  ]);
});
