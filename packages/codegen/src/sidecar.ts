/**
 * The committed `*.rncanvas.json` sidecar (PRD §6/§7.5, BUILD Phase 3). It holds
 * the canonical node tree + design metadata and is what the studio loads — the
 * generated code is never reverse-engineered back into the document.
 *
 * Design metadata lives ONLY here, never in the emitted code (see emit.ts).
 */
import {
  validateComponentRegistry,
  validateTree,
  type ComponentRegistry,
  type Node,
} from "@rn-canvas/document";

export interface SidecarDocument {
  version: 1;
  screenName: string;
  /** The full node tree, including design-time metadata. */
  root: Node;
  /** Reusable component definitions referenced by this document (Phase 2C). */
  components?: ComponentRegistry;
}

export function buildSidecar(
  root: Node,
  opts: { screenName?: string; components?: ComponentRegistry } = {},
): SidecarDocument {
  const doc: SidecarDocument = { version: 1, screenName: opts.screenName ?? "Screen", root };
  if (opts.components && Object.keys(opts.components).length > 0) doc.components = opts.components;
  return doc;
}

export function serializeSidecar(doc: SidecarDocument): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

export function parseSidecar(json: string): SidecarDocument {
  const data = JSON.parse(json) as unknown;
  if (
    typeof data !== "object" ||
    data === null ||
    (data as { version?: unknown }).version !== 1 ||
    typeof (data as { screenName?: unknown }).screenName !== "string" ||
    typeof (data as { root?: unknown }).root !== "object"
  ) {
    throw new Error("Invalid .rncanvas.json sidecar");
  }
  const sidecar = data as SidecarDocument;
  const errors = validateTree(sidecar.root);
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(`Invalid .rncanvas.json sidecar: ${first.key} ${first.reason}`);
  }
  if (sidecar.components !== undefined) {
    if (typeof sidecar.components !== "object" || sidecar.components === null) {
      throw new Error("Invalid .rncanvas.json sidecar: components must be an object");
    }
    const regErrors = validateComponentRegistry(sidecar.components);
    if (regErrors.length > 0) {
      const first = regErrors[0];
      throw new Error(`Invalid .rncanvas.json sidecar: ${first.key} ${first.reason}`);
    }
  }
  return sidecar;
}
