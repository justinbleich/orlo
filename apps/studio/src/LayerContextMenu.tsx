/**
 * Right-click menu for a document layer — shared by the canvas overlay and the
 * layer tree. State lives in the studio store so either surface can open it;
 * App renders the single instance with fixed positioning (immune to the canvas
 * transform).
 */
import { useEffect, useRef } from "react";
import {
  findNode,
  RN_PRIMITIVES,
  useDocumentStore,
  type NodeId,
} from "@rn-canvas/document";
import { Component, Copy, Eye, EyeOff, Lock, LockOpen, Trash2 } from "lucide-react";
import { deleteNodes, duplicateNodes } from "./document-actions";
import { useStudioStore } from "./studio-store";
import { cn } from "./studio-ui";

export type LayerMenuState = { rootId: NodeId; nodeId: NodeId; x: number; y: number };

function pascalCase(input: string): string {
  return input
    .replace(/[^A-Za-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("") || "Component";
}

const MENU_WIDTH = 208;

export function LayerContextMenu() {
  const menu = useStudioStore((state) => state.layerMenu);
  const close = useStudioStore((state) => state.closeLayerMenu);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) {
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [menu, close]);

  if (!menu) return null;
  const store = useDocumentStore.getState();
  const root = store.roots[menu.rootId];
  const node = root ? findNode(root, menu.nodeId) : undefined;
  if (!root || !node) return null;

  const isRoot = node.id === root.id;
  const isInstance = node.type === "ComponentInstance";
  const hidden = !!node.design?.hidden;
  const locked = !!node.design?.locked;

  const run = (action: () => void) => () => {
    close();
    try {
      action();
    } catch {
      /* invalid action for this node — leave the document unchanged */
    }
  };

  const promote = run(() => {
    const pascal = pascalCase(node.design?.name ?? node.type);
    const base = (RN_PRIMITIVES as readonly string[]).includes(pascal)
      ? `${pascal}Component`
      : pascal;
    const taken = new Set(Object.values(store.components).map((c) => c.name));
    let name = base;
    for (let i = 2; taken.has(name); i += 1) name = `${base}${i}`;
    useDocumentStore.getState().promoteToComponent(menu.rootId, menu.nodeId, name);
  });

  const items: Array<
    | { kind: "action"; label: string; icon: React.ReactNode; onSelect: () => void; disabled?: boolean }
    | { kind: "divider" }
  > = [
    {
      kind: "action",
      label: "Duplicate",
      icon: <Copy size={13} aria-hidden="true" />,
      onSelect: run(() => {
        const ids = duplicateNodes(menu.rootId, [menu.nodeId]);
        if (ids.length) useDocumentStore.getState().setSelection(ids);
      }),
      disabled: isRoot || locked,
    },
    {
      kind: "action",
      label: "Create component",
      icon: <Component size={13} aria-hidden="true" />,
      onSelect: promote,
      disabled: isRoot || isInstance || locked,
    },
    { kind: "divider" },
    {
      kind: "action",
      label: hidden ? "Show" : "Hide",
      icon: hidden ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />,
      onSelect: run(() =>
        useDocumentStore
          .getState()
          .updateDesign(menu.rootId, menu.nodeId, { hidden: hidden ? undefined : true }),
      ),
      disabled: isRoot,
    },
    {
      kind: "action",
      label: locked ? "Unlock" : "Lock",
      icon: locked ? (
        <LockOpen size={13} aria-hidden="true" />
      ) : (
        <Lock size={13} aria-hidden="true" />
      ),
      onSelect: run(() =>
        useDocumentStore
          .getState()
          .updateDesign(menu.rootId, menu.nodeId, { locked: locked ? undefined : true }),
      ),
    },
    { kind: "divider" },
    {
      kind: "action",
      label: "Delete",
      icon: <Trash2 size={13} aria-hidden="true" />,
      onSelect: run(() => deleteNodes(menu.rootId, [menu.nodeId])),
      disabled: isRoot || locked,
    },
  ];

  const left = Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(menu.y, window.innerHeight - 220);

  return (
    <div
      ref={ref}
      role="menu"
      className="studio-chrome fixed z-50 flex flex-col rounded-sm border border-line bg-chrome py-2xs shadow-popover"
      style={{ left, top, width: MENU_WIDTH }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item.kind === "divider" ? (
          <div key={index} className="mx-2xs my-2xs h-px bg-line-soft" aria-hidden="true" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={item.onSelect}
            className={cn(
              "flex items-center gap-sm px-md py-xs text-left text-sm text-ink transition-colors",
              item.disabled
                ? "cursor-default text-ink-faint"
                : "hover:bg-accent-soft hover:text-accent",
            )}
          >
            {item.icon}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
