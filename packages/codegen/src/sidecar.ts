/**
 * Optional RN Studio metadata for an editable projection.
 *
 * For Studio-authored objects, this stores the richest known Node tree and
 * design metadata so Canvas can reopen with full fidelity. For repo-authored
 * objects, source on the active branch remains durable truth; a sidecar can
 * assist projection/editability, but it must not become a competing project
 * source of truth.
 *
 * Design metadata is intentionally kept out of emitted runtime code (see
 * emit.ts). Source writers may regenerate or reconcile this metadata as needed.
 */
import {
  validateComponentRegistry,
  validateTokenRegistry,
  validateTree,
  type ComponentRegistry,
  type Node,
  type TokenRegistry,
} from "@rn-canvas/document";

export interface SidecarDocument {
  version: 1;
  screenName: string;
  /** The projected editable node tree, including design-time metadata. */
  root: Node;
  /** Reusable component definitions referenced by this document (Phase 2C). */
  components?: ComponentRegistry;
  /** Design tokens referenced by this document (Phase 2D). */
  tokens?: TokenRegistry;
}

export function buildSidecar(
  root: Node,
  opts: { screenName?: string; components?: ComponentRegistry; tokens?: TokenRegistry } = {},
): SidecarDocument {
  const doc: SidecarDocument = { version: 1, screenName: opts.screenName ?? "Screen", root };
  if (opts.components && Object.keys(opts.components).length > 0) doc.components = opts.components;
  if (opts.tokens && Object.keys(opts.tokens).length > 0) doc.tokens = opts.tokens;
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
  if (sidecar.tokens !== undefined) {
    if (typeof sidecar.tokens !== "object" || sidecar.tokens === null) {
      throw new Error("Invalid .rncanvas.json sidecar: tokens must be an object");
    }
    const tokenErrors = validateTokenRegistry(sidecar.tokens);
    if (tokenErrors.length > 0) {
      const first = tokenErrors[0];
      throw new Error(`Invalid .rncanvas.json sidecar: ${first.key} ${first.reason}`);
    }
  }
  return sidecar;
}
