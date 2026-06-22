/**
 * The Phase 0 fixture, re-expressed as a canonical document tree. Used by the
 * render/diff harness and tests. Replaces the old `@rn-canvas/fixture` package.
 */
import type { Node } from "./types";

/**
 * Bundled 48×48 image as a data URI. Same-origin and deterministic, so the
 * canvas snapshot never taints and canvas/native renders stay byte-stable for
 * the fidelity diff.
 */
export const FIXTURE_IMAGE_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAp0lEQVR4AdXBQQqDUBAFwZ7Gi+bauUoWE0EhigquzH9V9Xp/uKl5VnHDxLXmv5q94sTEUTOmZlFsyF4zvmZDfpoczUrCyaLJ08wknISTcAJNrpZwEk7CSTgJJ+EknISTcBJOwkk4CSfhJJyEk3ASTsJJOAkn4SSchJNwEk7CCRS5SsJJOAkniyJPMZNw8lPkKFayV4yv2Jg4KhbNWIoTE9eKveZZxQ1f+qIRngMFE4cAAAAASUVORK5CYII=";

/** Phase 0 spike tree: a row with a Text and an Image. */
export const sampleDocument: Node = {
  id: "sample-root",
  type: "View",
  props: {},
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
      id: "sample-text",
      type: "Text",
      props: { text: "Hello RN Canvas" },
      style: {
        fontFamily: "Inter",
        fontSize: 18,
        fontWeight: "600",
        color: "#111111",
      },
    },
    {
      id: "sample-image",
      type: "Image",
      props: { source: { uri: FIXTURE_IMAGE_URI }, resizeMode: "contain" },
      style: { width: 48, height: 48 },
    },
  ],
};
