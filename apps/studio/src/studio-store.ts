import { create } from "zustand";
import type { NodeId, RNPrimitive } from "@rn-canvas/document";
import type { LayoutReadyResult } from "@rn-canvas/render-web";

export type CanvasTool = "select" | "hand" | "zoom";

/**
 * Studio UI state that isn't part of the document — kept separate from the
 * document store so it never enters undo history or the sidecar. A standalone
 * store (rather than React context) so tldraw-hosted shapes/overlays can read it
 * without prop threading.
 */
interface StudioState {
  /** Active tldraw host navigation tool. Creation tools clear back to select. */
  canvasTool: CanvasTool;
  setCanvasTool(tool: CanvasTool): void;
  /** A creation tool armed from the rail; the next canvas drag draws this node. */
  armedTool: RNPrimitive | null;
  setArmedTool(tool: RNPrimitive | null): void;
  /** A component armed for placement; the next canvas drag places an instance.
   *  Mutually exclusive with `armedTool` — arming one disarms the other. */
  armedComponentId: string | null;
  setArmedComponent(componentId: string | null): void;
  /** Latest Yoga result per live frame; derived UI data, never serialized. */
  layouts: Record<NodeId, LayoutReadyResult>;
  setLayout(rootId: NodeId, result: LayoutReadyResult): void;
  /** While editing a component in focus mode, the variant being authored
   *  (property → value). Non-default selections route layer style/visibility
   *  edits into that variant's override. UI-only; cleared when focus mode ends. */
  activeVariant: Record<string, string>;
  setActiveVariant(propertyName: string, value: string): void;
  resetActiveVariant(): void;
}

export const useStudioStore = create<StudioState>((set) => ({
  canvasTool: "select",
  setCanvasTool: (canvasTool) => set({ canvasTool, armedTool: null, armedComponentId: null }),
  armedTool: null,
  setArmedTool: (armedTool) => set({ canvasTool: "select", armedTool, armedComponentId: null }),
  armedComponentId: null,
  setArmedComponent: (armedComponentId) =>
    set({ canvasTool: "select", armedComponentId, armedTool: null }),
  layouts: {},
  setLayout: (rootId, result) =>
    set((state) => ({ layouts: { ...state.layouts, [rootId]: result } })),
  activeVariant: {},
  setActiveVariant: (propertyName, value) =>
    set((state) => ({ activeVariant: { ...state.activeVariant, [propertyName]: value } })),
  resetActiveVariant: () => set({ activeVariant: {} }),
}));
