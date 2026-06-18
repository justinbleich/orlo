export type FixtureNodeType = "View" | "Text" | "Image";

export type FixtureNode = {
  type: FixtureNodeType;
  style?: Record<string, unknown>;
  props?: Record<string, unknown>;
  children?: FixtureNode[];
};

/** Phase 0 spike: row layout with Text + Image children. */
export const phase0Fixture: FixtureNode = {
  type: "View",
  style: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    width: 320,
    height: 120,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  children: [
    {
      type: "Text",
      props: { children: "Hello RN Canvas" },
      style: { fontSize: 18, fontWeight: "600", color: "#111111" },
    },
    {
      type: "Image",
      props: {
        source: {
          uri: "https://reactnative.dev/img/tiny_logo.png",
        },
      },
      style: { width: 48, height: 48 },
    },
  ],
};

export const FIXTURE_IMAGE_URI =
  "https://reactnative.dev/img/tiny_logo.png";
