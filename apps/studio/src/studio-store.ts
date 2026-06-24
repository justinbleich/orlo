import { create } from "zustand";
import type { RNPrimitive } from "@rn-canvas/document";

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
}

export const useStudioStore = create<StudioState>((set) => ({
  armedTool: null,
  setArmedTool: (armedTool) => set({ armedTool }),
}));
