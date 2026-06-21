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

/** Generate a screen's code and its committed sidecar together (BUILD Phase 3). */
export function generateScreen(root: Node, opts: EmitOptions = {}): GeneratedScreen {
  const screenName = opts.screenName ?? "Screen";
  return {
    screenName,
    code: emitScreen(root, { screenName }),
    sidecar: serializeSidecar(buildSidecar(root, { screenName })),
  };
}
