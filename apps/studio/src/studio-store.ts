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
  setActiveVariantAll(values: Record<string, string>): void;
  resetActiveVariant(): void;
  /** Last definition edit per component (ms epoch), for the workspace header's
   *  "edited Nm ago" pill. Session-scoped; never serialized. */
  componentEditedAt: Record<string, number>;
  markComponentEdited(componentId: string): void;
  /** Collapsed layer-tree rows, keyed by node id. Lifted here (not per-row
   *  React state) so expand state survives tree remounts. */
  collapsedLayers: Record<NodeId, boolean>;
  toggleLayerCollapsed(nodeId: NodeId): void;
  /** Open layer context menu (canvas or tree). One at a time, app-wide. */
  layerMenu: { rootId: NodeId; nodeId: NodeId; x: number; y: number } | null;
  openLayerMenu(menu: { rootId: NodeId; nodeId: NodeId; x: number; y: number }): void;
  closeLayerMenu(): void;
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
  setActiveVariantAll: (values) => set({ activeVariant: values }),
  resetActiveVariant: () => set({ activeVariant: {} }),
  componentEditedAt: {},
  markComponentEdited: (componentId) =>
    set((state) => ({
      componentEditedAt: { ...state.componentEditedAt, [componentId]: Date.now() },
    })),
  collapsedLayers: {},
  toggleLayerCollapsed: (nodeId) =>
    set((state) => ({
      collapsedLayers: { ...state.collapsedLayers, [nodeId]: !state.collapsedLayers[nodeId] },
    })),
  layerMenu: null,
  openLayerMenu: (layerMenu) => set({ layerMenu }),
  closeLayerMenu: () => set({ layerMenu: null }),
}));
