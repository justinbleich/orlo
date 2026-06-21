import type { Node } from "@rn-canvas/document";
import { emitScreen, type EmitOptions } from "./emit";
import { buildSidecar, serializeSidecar, type SidecarDocument } from "./sidecar";

export { emitScreen, type EmitOptions } from "./emit";
export {
  buildSidecar,
  serializeSidecar,
  parseSidecar,
  type SidecarDocument,
} from "./sidecar";

export interface GeneratedScreen {
  screenName: string;
  /** Idiomatic RN source (no design metadata). */
  code: string;
  /** Serialized `*.rncanvas.json` sidecar (canonical tree + design metadata). */
  sidecar: string;
}

export interface ScreenDocument {
  screenName: string;
  root: Node;
}

/** Generate a screen's code and its committed sidecar together (BUILD Phase 3). */
export function generateScreen(root: Node, opts: EmitOptions = {}): GeneratedScreen {
  const screenName = opts.screenName ?? "Screen";
  return {
    screenName,
    code: emitScreen(root, { screenName }),
    sidecar: serializeSidecar(buildSidecar(root, { screenName })),
  };
}

/**
 * Serialize document roots as independently registerable React Navigation
 * screen modules. v1 deliberately stops at screen stubs: navigator graphs,
 * route params, and transitions belong to the post-v1 interaction roadmap.
 */
export function generateScreens(screens: readonly ScreenDocument[]): GeneratedScreen[] {
  const names = new Set<string>();
  return screens.map(({ root, screenName }) => {
    if (!/^[A-Z][A-Za-z0-9_$]*$/.test(screenName)) {
      throw new Error(`Invalid screen name: ${screenName}`);
    }
    if (names.has(screenName)) {
      throw new Error(`Duplicate screen name: ${screenName}`);
    }
    names.add(screenName);
    return generateScreen(root, { screenName });
  });
}
