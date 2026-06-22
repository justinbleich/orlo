import {
  childrenOf,
  useDocumentStore,
  type Node,
  type NodeId,
} from "@rn-canvas/document";
import { color, radius, space, text } from "./studio-theme";

export function DocumentTree({
  node,
  rootId,
  selectedId,
  depth = 0,
}: {
  node: Node;
  rootId: NodeId;
  selectedId: NodeId | null;
  depth?: number;
}) {
  const setSelection = useDocumentStore((state) => state.setSelection);
  const updateDesign = useDocumentStore((state) => state.updateDesign);
  const selected = node.id === selectedId;
  const locked = !!node.design?.locked;
  const label = node.design?.name ?? node.type;

  return (
    <>
      <div
        onClick={() => {
          if (!locked) setSelection([node.id]);
        }}
        style={{
          padding: `${space.xs} ${space.sm}`,
          paddingLeft: `calc(${space.sm} + ${depth} * ${space.md})`,
          cursor: locked ? "not-allowed" : "pointer",
          fontSize: text.sm,
          background: selected ? color.accent : "transparent",
          color: node.design?.hidden ? color.inkFaint : color.ink,
          borderRadius: radius.sm,
        }}
      >
        {locked && (
          <button
            type="button"
            title="Unlock"
            onClick={(event) => {
              event.stopPropagation();
              updateDesign(rootId, node.id, { locked: false });
            }}
            style={{
              border: 0,
              padding: 0,
              marginRight: space.xs,
              background: "transparent",
              color: "inherit",
            }}
          >
            L
          </button>
        )}
        {node.design?.hidden ? "◌ " : ""}
        {label} <span style={{ color: color.inkFaint }}>· {node.type}</span>
      </div>
      {childrenOf(node).map((child) => (
        <DocumentTree
          key={child.id}
          node={child}
          rootId={rootId}
          selectedId={selectedId}
          depth={depth + 1}
        />
      ))}
    </>
  );
}
