export type FixtureNodeType = "View" | "Text" | "Image";

export type FixtureNode = {
  type: FixtureNodeType;
  style?: Record<string, unknown>;
  props?: Record<string, unknown>;
  children?: FixtureNode[];
};

/**
 * Bundled 48×48 image as a data URI. Same-origin and deterministic, so the
 * canvas snapshot never taints (a hotlinked remote image fails CORS inlining)
 * and the canvas/native renders stay byte-stable for the fidelity diff.
 */
export const FIXTURE_IMAGE_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAp0lEQVR4AdXBQQqDUBAFwZ7Gi+bauUoWE0EhigquzH9V9Xp/uKl5VnHDxLXmv5q94sTEUTOmZlFsyF4zvmZDfpoczUrCyaLJ08wknISTcAJNrpZwEk7CSTgJJ+EknISTcBJOwkk4CSfhJJyEk3ASTsJJOAkn4SSchJNwEk7CCRS5SsJJOAkniyJPMZNw8lPkKFayV4yv2Jg4KhbNWIoTE9eKveZZxQ1f+qIRngMFE4cAAAAASUVORK5CYII=";

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
          uri: FIXTURE_IMAGE_URI,
        },
      },
      style: { width: 48, height: 48 },
    },
  ],
};
