import {
  childrenOf,
  type ComponentDefinition,
  type ComponentRegistry,
  type Node,
  type TokenRegistry,
} from "@rn-canvas/document";
import { emitScreen, type EmitOptions } from "./emit";
import { emitComponent, type GeneratedComponent } from "./emit-component";
import { emitTheme, type GeneratedTheme } from "./emit-theme";
import { buildSidecar, serializeSidecar, type SidecarDocument } from "./sidecar";

export { emitScreen, type EmitOptions } from "./emit";
export { emitComponent, type GeneratedComponent } from "./emit-component";
export { emitTheme, type GeneratedTheme } from "./emit-theme";
export {
  buildSidecar,
  serializeSidecar,
  parseSidecar,
  type SidecarDocument,
} from "./sidecar";
export {
  parseExternalScreen,
  type ParseExternalOptions,
  type ParsedExternalScreen,
} from "./parse-external";

export interface GeneratedScreen {
  screenName: string;
  /** Idiomatic RN source (no design metadata). */
  code: string;
  /** Serialized `*.rncanvas.json` sidecar (canonical tree + design metadata). */
  sidecar: string;
  /** Standalone modules for every component this screen uses (transitively). */
  components: GeneratedComponent[];
  /** The shared `theme.ts` module, present when any emitted style references a token. */
  theme?: GeneratedTheme;
}

export interface ScreenDocument {
  screenName: string;
  root: Node;
}

/** Definitions used by a tree, transitively (instances + their templates + slots). */
function collectUsedComponents(
  node: Node,
  registry: ComponentRegistry,
  acc = new Map<string, ComponentDefinition>(),
): Map<string, ComponentDefinition> {
  if (node.type === "ComponentInstance") {
    const def = registry[node.componentId];
    if (def && !acc.has(def.id)) {
      acc.set(def.id, def);
      collectUsedComponents(def.template, registry, acc);
    }
    if (node.slots) {
      for (const kids of Object.values(node.slots)) {
        for (const kid of kids) collectUsedComponents(kid, registry, acc);
      }
    }
    return acc;
  }
  for (const child of childrenOf(node)) collectUsedComponents(child, registry, acc);
  return acc;
}

/** Whether any node in a tree binds a style key to a token that exists in the registry. */
function hasTokenBinding(node: Node, tokens: TokenRegistry): boolean {
  const bound = node.design?.tokens;
  if (bound && Object.values(bound).some((id) => tokens[id])) return true;
  if (childrenOf(node).some((child) => hasTokenBinding(child, tokens))) return true;
  if (node.type === "ComponentInstance" && node.slots) {
    for (const kids of Object.values(node.slots)) {
      if (kids.some((kid) => hasTokenBinding(kid, tokens))) return true;
    }
  }
  return false;
}

/** Generate a screen's code, its sidecar, the component modules it uses, and the
 *  shared theme module when any of them reference a design token. */
export function generateScreen(root: Node, opts: EmitOptions = {}): GeneratedScreen {
  const screenName = opts.screenName ?? "Screen";
  const registry = opts.components ?? {};
  const tokens = opts.tokens ?? {};
  const used = [...collectUsedComponents(root, registry).values()];
  const referencesToken =
    hasTokenBinding(root, tokens) || used.some((def) => hasTokenBinding(def.template, tokens));
  return {
    screenName,
    code: emitScreen(root, { screenName, components: registry, tokens }),
    sidecar: serializeSidecar(buildSidecar(root, { screenName, components: registry, tokens })),
    components: used.map((def) => emitComponent(def, registry, tokens)),
    theme: referencesToken ? emitTheme(tokens) : undefined,
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
