/**
 * Studio shell — the region skeleton from STUDIO-UI.md. Structure + token styling
 * only; each region's functional UI fills in as its phase lands. Chrome only:
 * everything here is theme-token-styled and never touches RN artboard content.
 */
import { useState } from "react";
import { color, layout, radius, space, text } from "./studio-theme";

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

/** A quiet segmented tab bar used by the left panel and inspector. */
export function Tabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: string[];
  active: string;
  onSelect: (t: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: space.xs,
        padding: space.xs,
        background: color.chrome2,
        borderRadius: radius.base,
      }}
    >
      {tabs.map((t) => {
        const on = t === active;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onSelect(t)}
            style={{
              flex: 1,
              padding: `${space.xs} ${space.sm}`,
              border: "none",
              borderRadius: radius.sm,
              background: on ? color.raised : "transparent",
              color: on ? color.ink : color.inkDim,
              fontSize: text.xs,
              fontWeight: 600,
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: color.inkFaint, fontSize: text.sm, margin: 0, lineHeight: 1.6 }}>
      {children}
    </p>
  );
}

/** Left creation-tool rail. v1 canvas creation is Frame only (child primitives are
 *  added via the inspector tree, not canvas draw tools). Rectangle/Text/Image/
 *  Component/Icon/Connect tools are phase2.md/phase3 authoring — not shown in v1. */
export function ToolRail({ onAddFrame }: { onAddFrame: () => void }) {
  const tools: { glyph: string; label: string; onClick?: () => void }[] = [
    { glyph: "⌖", label: "Select" },
    { glyph: "▭", label: "Frame", onClick: onAddFrame },
  ];
  return (
    <nav
      style={{
        flex: `0 0 ${layout.rail}px`,
        width: layout.rail,
        background: color.chrome,
        borderRight: `1px solid ${color.line}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: space.xs,
        padding: `${space.sm} 0`,
      }}
    >
      {tools.map((t) => {
        const wired = !!t.onClick;
        return (
          <button
            key={t.label}
            type="button"
            title={wired ? t.label : `${t.label} — coming soon`}
            onClick={t.onClick}
            disabled={!wired}
            style={{
              width: 36,
              height: 36,
              borderRadius: radius.sm,
              border: `1px solid ${color.line}`,
              background: color.chrome2,
              color: wired ? color.ink : color.inkFaint,
              fontSize: text.base,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {t.glyph}
          </button>
        );
      })}
    </nav>
  );
}

/** Left panel: Screens / Layers / Library tabs. Placeholder bodies for now. */
export function LeftPanel() {
  const [tab, setTab] = useState("Screens");
  return (
    <aside
      style={{
        flex: `0 0 ${layout.leftPanel}px`,
        width: layout.leftPanel,
        background: color.chrome,
        borderRight: `1px solid ${color.line}`,
        display: "flex",
        flexDirection: "column",
        gap: space.md,
        padding: space.md,
        overflowY: "auto",
      }}
    >
      {/* Library (components/tokens) is post-v1 — not shown in v1. */}
      <Tabs tabs={["Screens", "Layers"]} active={tab} onSelect={setTab} />
      {tab === "Screens" && <Placeholder>Screen list — frames you add appear on the canvas. Management UI lands with navigation (phase 3).</Placeholder>}
      {tab === "Layers" && <Placeholder>Node tree — currently in the Inspector’s Design tab; moves here as the layers panel fills in.</Placeholder>}
    </aside>
  );
}
