import { useState } from "react";
import {
  childrenOf,
  findNode,
  useDocumentStore,
  type Node,
  type NodeId,
} from "@rn-canvas/document";

const PANEL_BG = "#1b1f27";
const ROW_BG = "#222732";

function NodeTreeRow({
  node,
  rootId,
  depth,
  selectedId,
}: {
  node: Node;
  rootId: NodeId;
  depth: number;
  selectedId: NodeId | null;
}) {
  const setSelection = useDocumentStore((s) => s.setSelection);
  const updateDesign = useDocumentStore((s) => s.updateDesign);
  const isSelected = node.id === selectedId;
  const locked = !!node.design?.locked;
  const label = node.design?.name ?? node.type;
  return (
    <>
      <div
        // A locked node is not selectable; click the lock glyph to unlock.
        onClick={() => {
          if (!locked) setSelection([node.id]);
        }}
        style={{
          padding: "4px 8px",
          paddingLeft: 8 + depth * 14,
          cursor: locked ? "not-allowed" : "pointer",
          fontSize: 12,
          background: isSelected ? "#2d6cdf" : "transparent",
          color: node.design?.hidden ? "#777" : "#dfe3ea",
          borderRadius: 4,
        }}
      >
        {locked && (
          <span
            title="Unlock"
            onClick={(e) => {
              e.stopPropagation();
              updateDesign(rootId, node.id, { locked: false });
            }}
            style={{ cursor: "pointer" }}
          >
            🔒{" "}
          </span>
        )}
        {node.design?.hidden ? "◌ " : ""}
        {label} <span style={{ color: "#7c8492" }}>· {node.type}</span>
      </div>
      {childrenOf(node).map((child) => (
        <NodeTreeRow
          key={child.id}
          node={child}
          rootId={rootId}
          depth={depth + 1}
          selectedId={selectedId}
        />
      ))}
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
      <span style={{ color: "#9aa0a6" }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#11141a",
  border: "1px solid #333a47",
  borderRadius: 4,
  color: "#e6e9ee",
  padding: "5px 7px",
  fontSize: 12,
};

export function Inspector({ rootId }: { rootId: NodeId | null }) {
  const root = useDocumentStore((s) => (rootId ? s.roots[rootId] : undefined));
  const selection = useDocumentStore((s) => s.selection);
  const updateProps = useDocumentStore((s) => s.updateProps);
  const updateStyle = useDocumentStore((s) => s.updateStyle);
  const updateDesign = useDocumentStore((s) => s.updateDesign);
  const [error, setError] = useState<string | null>(null);

  const selectedId = selection[0] ?? null;
  const node = root && selectedId ? findNode(root, selectedId) : undefined;

  function guard(fn: () => void) {
    try {
      setError(null);
      fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setStyle = (key: string, value: any) =>
    guard(() => updateStyle(rootId!, selectedId!, { [key]: value }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setProp = (key: string, value: any) =>
    guard(() => updateProps(rootId!, selectedId!, { [key]: value }));

  const numberOrUndef = (v: string) => (v === "" ? undefined : Number(v));

  return (
    <aside
      style={{
        width: 280,
        flex: "0 0 280px",
        background: PANEL_BG,
        borderLeft: "1px solid #2a2f3a",
        overflowY: "auto",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <strong style={{ fontSize: 13 }}>Inspector</strong>

      {!root && <p style={{ color: "#7c8492", fontSize: 12 }}>Select a frame.</p>}

      {root && (
        <section>
          <div style={{ color: "#9aa0a6", fontSize: 11, marginBottom: 4 }}>Tree</div>
          <div style={{ background: ROW_BG, borderRadius: 6, padding: 4 }}>
            <NodeTreeRow node={root} rootId={root.id} depth={0} selectedId={selectedId} />
          </div>
        </section>
      )}

      {node && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ color: "#9aa0a6", fontSize: 11 }}>
            {node.type} · {node.id.slice(0, 8)}
          </div>

          {/* Design metadata */}
          <Field label="Name">
            <input
              style={inputStyle}
              value={node.design?.name ?? ""}
              onChange={(e) =>
                guard(() => updateDesign(rootId!, node.id, { name: e.target.value }))
              }
            />
          </Field>
          <div style={{ display: "flex", gap: 14 }}>
            <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!node.design?.locked}
                onChange={(e) =>
                  guard(() => updateDesign(rootId!, node.id, { locked: e.target.checked }))
                }
              />
              Locked
            </label>
            <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!node.design?.hidden}
                onChange={(e) =>
                  guard(() => updateDesign(rootId!, node.id, { hidden: e.target.checked }))
                }
              />
              Hidden
            </label>
          </div>

          {node.type === "Text" && (
            <>
              <Field label="Text">
                <input
                  style={inputStyle}
                  value={node.props.text}
                  onChange={(e) => setProp("text", e.target.value)}
                />
              </Field>
              <Field label="Font size">
                <input
                  style={inputStyle}
                  type="number"
                  value={node.style.fontSize ?? ""}
                  onChange={(e) => setStyle("fontSize", numberOrUndef(e.target.value))}
                />
              </Field>
              <Field label="Color">
                <input
                  style={{ ...inputStyle, padding: 2, height: 28 }}
                  type="color"
                  value={node.style.color ?? "#000000"}
                  onChange={(e) => setStyle("color", e.target.value)}
                />
              </Field>
            </>
          )}

          <Field label="Background color">
            <input
              style={{ ...inputStyle, padding: 2, height: 28 }}
              type="color"
              value={node.style.backgroundColor ?? "#ffffff"}
              onChange={(e) => setStyle("backgroundColor", e.target.value)}
            />
          </Field>
          <div style={{ display: "flex", gap: 8 }}>
            <Field label="Width">
              <input
                style={inputStyle}
                type="number"
                value={typeof node.style.width === "number" ? node.style.width : ""}
                onChange={(e) => setStyle("width", numberOrUndef(e.target.value))}
              />
            </Field>
            <Field label="Height">
              <input
                style={inputStyle}
                type="number"
                value={typeof node.style.height === "number" ? node.style.height : ""}
                onChange={(e) => setStyle("height", numberOrUndef(e.target.value))}
              />
            </Field>
          </div>
          <Field label="Padding">
            <input
              style={inputStyle}
              type="number"
              value={typeof node.style.padding === "number" ? node.style.padding : ""}
              onChange={(e) => setStyle("padding", numberOrUndef(e.target.value))}
            />
          </Field>

          {error && (
            <p style={{ color: "#ff8a8a", fontSize: 11, margin: 0 }}>{error}</p>
          )}
        </section>
      )}
    </aside>
  );
}
