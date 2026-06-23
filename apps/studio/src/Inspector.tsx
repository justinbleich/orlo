import { useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  MousePointerClick,
  MoveVertical,
  List as ListIcon,
  Square,
  TextCursorInput,
  Type as TypeIcon,
  Unlock,
  type LucideIcon,
} from "lucide-react";
import {
  canHaveChildren,
  findNode,
  useDocumentStore,
  type Node,
  type NodeId,
  type RNPrimitive,
} from "@rn-canvas/document";
import {
  ColorField,
  Field,
  FieldGrid,
  IconToggle,
  NumberField,
  Section,
  SegmentedControl,
  Select,
  TextField,
} from "./studio-ui";

const TYPE_ICON: Record<RNPrimitive, LucideIcon> = {
  View: Square,
  Text: TypeIcon,
  Image: ImageIcon,
  Pressable: MousePointerClick,
  ScrollView: MoveVertical,
  TextInput: TextCursorInput,
  FlatList: ListIcon,
};

const JUSTIFY_OPTIONS = [
  { value: "flex-start", label: "Start" },
  { value: "center", label: "Center" },
  { value: "flex-end", label: "End" },
  { value: "space-between", label: "Space between" },
  { value: "space-around", label: "Space around" },
  { value: "space-evenly", label: "Space evenly" },
] as const;

const ALIGN_OPTIONS = [
  { value: "stretch", label: "Stretch" },
  { value: "flex-start", label: "Start" },
  { value: "center", label: "Center" },
  { value: "flex-end", label: "End" },
  { value: "baseline", label: "Baseline" },
] as const;

const WEIGHT_OPTIONS = [
  { value: "normal", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
] as const;

/** Numeric value of an RNStyle dimension, or undefined when auto/percent/unset. */
function numeric(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** Placeholder hint for a non-numeric dimension (auto / "50%"). */
function dimHint(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

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

  // All edits route through the validated document-store actions — never direct
  // node mutation — so the document stays single-source and re-validates per edit.
  const setStyle = (key: string, value: unknown) =>
    guard(() => updateStyle(rootId!, selectedId!, { [key]: value }));
  const setProp = (key: string, value: unknown) =>
    guard(() => updateProps(rootId!, selectedId!, { [key]: value }));
  const setDesign = (partial: Record<string, unknown>) =>
    guard(() => updateDesign(rootId!, node!.id, partial));

  if (!root) {
    return (
      <Shell>
        <Empty>Select a frame to inspect.</Empty>
      </Shell>
    );
  }
  if (!node) {
    return (
      <Shell>
        <Empty>Select a layer to edit its properties.</Empty>
      </Shell>
    );
  }

  const s = node.style;
  const isContainerNode = canHaveChildren(node.type);

  return (
    <Shell>
      <SelectionHeader
        node={node}
        onName={(name) => setDesign({ name })}
        onLock={(locked) => setDesign({ locked })}
        onHide={(hidden) => setDesign({ hidden })}
      />

      <Section title="Layout">
        <Field label="Position">
          <SegmentedControl
            value={s.position ?? "relative"}
            onChange={(v) => setStyle("position", v === "relative" ? undefined : v)}
            options={[
              { value: "relative", content: "Relative", title: "Relative (flow)" },
              { value: "absolute", content: "Absolute", title: "Absolute (top/left)" },
            ]}
          />
        </Field>
        <FieldGrid>
          <Field label="Width">
            <NumberField
              label="W"
              value={numeric(s.width)}
              placeholder={dimHint(s.width) ?? "auto"}
              min={0}
              onChange={(v) => setStyle("width", v)}
            />
          </Field>
          <Field label="Height">
            <NumberField
              label="H"
              value={numeric(s.height)}
              placeholder={dimHint(s.height) ?? "auto"}
              min={0}
              onChange={(v) => setStyle("height", v)}
            />
          </Field>
        </FieldGrid>
        {s.position === "absolute" && (
          <FieldGrid>
            <Field label="Left">
              <NumberField label="L" value={numeric(s.left)} placeholder={dimHint(s.left)} onChange={(v) => setStyle("left", v)} />
            </Field>
            <Field label="Top">
              <NumberField label="T" value={numeric(s.top)} placeholder={dimHint(s.top)} onChange={(v) => setStyle("top", v)} />
            </Field>
          </FieldGrid>
        )}
        <Field label="Padding">
          <NumberField label="P" value={numeric(s.padding)} placeholder={dimHint(s.padding)} min={0} onChange={(v) => setStyle("padding", v)} />
        </Field>
      </Section>

      {isContainerNode && (
        <Section title="Auto Layout">
          <Field label="Direction">
            <SegmentedControl
              value={s.flexDirection ?? "column"}
              onChange={(v) => setStyle("flexDirection", v)}
              options={[
                { value: "row", content: <ArrowRight size={14} aria-hidden="true" />, title: "Row" },
                { value: "column", content: <ArrowDown size={14} aria-hidden="true" />, title: "Column" },
                { value: "row-reverse", content: <ArrowLeft size={14} aria-hidden="true" />, title: "Row reverse" },
                { value: "column-reverse", content: <ArrowUp size={14} aria-hidden="true" />, title: "Column reverse" },
              ]}
            />
          </Field>
          <Field label="Justify">
            <Select value={s.justifyContent} onChange={(v) => setStyle("justifyContent", v)} options={JUSTIFY_OPTIONS as never} placeholder="Start" />
          </Field>
          <Field label="Align">
            <Select value={s.alignItems} onChange={(v) => setStyle("alignItems", v)} options={ALIGN_OPTIONS as never} placeholder="Stretch" />
          </Field>
          <FieldGrid>
            <Field label="Gap">
              <NumberField label="G" value={numeric(s.gap)} min={0} onChange={(v) => setStyle("gap", v)} />
            </Field>
            <Field label="Wrap">
              <SegmentedControl
                value={s.flexWrap ?? "nowrap"}
                onChange={(v) => setStyle("flexWrap", v === "nowrap" ? undefined : v)}
                options={[
                  { value: "nowrap", content: "No", title: "No wrap" },
                  { value: "wrap", content: "Wrap", title: "Wrap" },
                ]}
              />
            </Field>
          </FieldGrid>
        </Section>
      )}

      {node.type === "Text" && (
        <Section title="Typography">
          <Field label="Content" stacked>
            <TextField value={node.props.text} onChange={(v) => setProp("text", v)} placeholder="Text…" />
          </Field>
          <FieldGrid>
            <Field label="Size">
              <NumberField label="S" value={s.fontSize} min={1} onChange={(v) => setStyle("fontSize", v)} />
            </Field>
            <Field label="Line height">
              <NumberField label="LH" value={s.lineHeight} min={0} onChange={(v) => setStyle("lineHeight", v)} />
            </Field>
          </FieldGrid>
          <Field label="Weight">
            <Select value={s.fontWeight} onChange={(v) => setStyle("fontWeight", v)} options={WEIGHT_OPTIONS as never} placeholder="Regular" />
          </Field>
          <Field label="Align">
            <SegmentedControl
              value={s.textAlign && s.textAlign !== "auto" ? s.textAlign : "left"}
              onChange={(v) => setStyle("textAlign", v)}
              options={[
                { value: "left", content: <AlignLeft size={14} aria-hidden="true" />, title: "Left" },
                { value: "center", content: <AlignCenter size={14} aria-hidden="true" />, title: "Center" },
                { value: "right", content: <AlignRight size={14} aria-hidden="true" />, title: "Right" },
                { value: "justify", content: <AlignJustify size={14} aria-hidden="true" />, title: "Justify" },
              ]}
            />
          </Field>
          <Field label="Color">
            <ColorField value={s.color} onChange={(v) => setStyle("color", v)} />
          </Field>
        </Section>
      )}

      <Section title="Appearance">
        <Field label="Fill">
          <ColorField value={s.backgroundColor} onChange={(v) => setStyle("backgroundColor", v)} />
        </Field>
        <Field label="Opacity">
          <NumberField label="○" value={s.opacity} min={0} max={1} step={0.05} onChange={(v) => setStyle("opacity", v)} />
        </Field>
        <FieldGrid>
          <Field label="Border width">
            <NumberField label="W" value={s.borderWidth} min={0} onChange={(v) => setStyle("borderWidth", v)} />
          </Field>
          <Field label="Radius">
            <NumberField label="R" value={s.borderRadius} min={0} onChange={(v) => setStyle("borderRadius", v)} />
          </Field>
        </FieldGrid>
        <Field label="Border color">
          <ColorField value={s.borderColor} onChange={(v) => setStyle("borderColor", v)} />
        </Field>
      </Section>

      {error && (
        <div className="mx-md mb-md rounded-sm border border-amber/40 bg-amber/10 px-sm py-xs text-xs text-amber">
          {error}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto bg-chrome">
      {children}
    </aside>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-md text-center text-sm text-ink-faint">
      {children}
    </div>
  );
}

function SelectionHeader({
  node,
  onName,
  onLock,
  onHide,
}: {
  node: Node;
  onName: (name: string) => void;
  onLock: (locked: boolean) => void;
  onHide: (hidden: boolean) => void;
}) {
  const Icon = TYPE_ICON[node.type];
  return (
    <div className="flex flex-col gap-sm border-b border-line px-md py-md">
      <div className="flex items-center gap-sm">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-chrome-2 text-ink-dim">
          <Icon size={15} aria-hidden="true" />
        </span>
        <input
          value={node.design?.name ?? ""}
          placeholder={node.type}
          onChange={(e) => onName(e.target.value)}
          className="h-7 min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-sm text-sm font-medium text-ink transition-colors hover:border-line focus-visible:border-accent-line focus-visible:bg-chrome-2 focus-visible:outline-none"
        />
        <IconToggle title={node.design?.locked ? "Unlock" : "Lock"} pressed={!!node.design?.locked} onPressedChange={onLock}>
          {node.design?.locked ? <Lock size={14} aria-hidden="true" /> : <Unlock size={14} aria-hidden="true" />}
        </IconToggle>
        <IconToggle title={node.design?.hidden ? "Show" : "Hide"} pressed={!!node.design?.hidden} onPressedChange={onHide}>
          {node.design?.hidden ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
        </IconToggle>
      </div>
      <div className="eyebrow pl-[2px]">
        {node.type} · {node.id.slice(0, 8)}
      </div>
    </div>
  );
}
