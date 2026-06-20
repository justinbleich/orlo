import { useState } from "react";
import {
  childrenOf,
  findNode,
  useDocumentStore,
  type Node,
  type NodeId,
} from "@rn-canvas/document";
import { color, radius, space, text } from "./studio-theme";

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
          padding: `${space.xs} ${space.sm}`,
          paddingLeft: `calc(${space.sm} + ${depth} * ${space.md})`,
          cursor: locked ? "not-allowed" : "pointer",
          fontSize: text.sm,
          background: isSelected ? color.accent : "transparent",
          color: node.design?.hidden ? color.inkFaint : color.ink,
          borderRadius: radius.sm,
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
        {label} <span style={{ color: color.inkFaint }}>· {node.type}</span>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label
      style={{ display: "flex", flexDirection: "column", gap: space.xs, fontSize: text.xs }}
    >
      <span style={{ color: color.inkDim }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: color.chrome2,
  border: `1px solid ${color.line}`,
  borderRadius: radius.sm,
  color: color.ink,
  padding: `${space.xs} ${space.sm}`,
  fontSize: text.sm,
};

const swatchStyle: React.CSSProperties = {
  ...inputStyle,
  padding: space.xs,
  height: space["2xl"],
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

  // All edits route through the validated document-store actions (updateProps /
  // updateStyle / updateDesign) — never direct node mutation — so the document
  // stays single-source and styles re-validate on every keystroke.
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
        width: "100%",
        height: "100%",
        background: color.chrome,
        overflowY: "auto",
        padding: space.md,
        display: "flex",
        flexDirection: "column",
        gap: space.md,
      }}
    >
      <div className="eyebrow">Inspector</div>

      {!root && (
        <p style={{ color: color.inkFaint, fontSize: text.sm }}>Select a frame.</p>
      )}

      {root && (
        <section>
          <div className="eyebrow" style={{ marginBottom: space.xs }}>
            Tree
          </div>
          <div
            style={{ background: color.chrome2, borderRadius: radius.base, padding: space.xs }}
          >
            <NodeTreeRow node={root} rootId={root.id} depth={0} selectedId={selectedId} />
          </div>
        </section>
      )}

      {node && (
        <section style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
          <div className="eyebrow">
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
          <div style={{ display: "flex", gap: space.lg, fontSize: text.sm, color: color.ink }}>
            <label style={{ display: "flex", gap: space.xs, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!node.design?.locked}
                onChange={(e) =>
                  guard(() => updateDesign(rootId!, node.id, { locked: e.target.checked }))
                }
              />
              Locked
            </label>
            <label style={{ display: "flex", gap: space.xs, alignItems: "center" }}>
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
                  style={swatchStyle}
                  type="color"
                  value={node.style.color ?? "#000000"}
                  onChange={(e) => setStyle("color", e.target.value)}
                />
              </Field>
            </>
          )}

          <Field label="Background color">
            <input
              style={swatchStyle}
              type="color"
              value={node.style.backgroundColor ?? "#ffffff"}
              onChange={(e) => setStyle("backgroundColor", e.target.value)}
            />
          </Field>
          <div style={{ display: "flex", gap: space.sm }}>
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
            <p style={{ color: color.amber, fontSize: text.xs, margin: 0 }}>{error}</p>
          )}
        </section>
      )}
    </aside>
  );
}
