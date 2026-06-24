import { create } from "zustand";
import type { NodeId, RNPrimitive } from "@rn-canvas/document";
import type { LayoutReadyResult } from "@rn-canvas/render-web";

/**
 * Studio UI state that isn't part of the document — kept separate from the
 * document store so it never enters undo history or the sidecar. A standalone
 * store (rather than React context) so tldraw-hosted shapes/overlays can read it
 * without prop threading.
 */
interface StudioState {
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
}

export const useStudioStore = create<StudioState>((set) => ({
  armedTool: null,
  setArmedTool: (armedTool) => set({ armedTool, armedComponentId: null }),
  armedComponentId: null,
  setArmedComponent: (armedComponentId) => set({ armedComponentId, armedTool: null }),
  layouts: {},
  setLayout: (rootId, result) =>
    set((state) => ({ layouts: { ...state.layouts, [rootId]: result } })),
}));
