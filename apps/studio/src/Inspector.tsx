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
  Boxes,
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

/** The RN style vocabulary, derived from the node model to avoid importing the
 *  styles package directly (keeps tsc resolution local to @rn-canvas/document). */
type Style = Node["style"];

/** Sentinel for "selected nodes disagree on this value". */
const MIXED = Symbol("mixed");
type Maybe<T> = T | typeof MIXED | undefined;
const isMixed = (v: unknown): v is typeof MIXED => v === MIXED;

/** Shared value of an accessor across nodes, or MIXED when they differ. */
function shared<T>(nodes: Node[], get: (n: Node) => T): Maybe<T> {
  if (nodes.length === 0) return undefined;
  const first = get(nodes[0]);
  for (let i = 1; i < nodes.length; i += 1) {
    if (!Object.is(get(nodes[i]), first)) return MIXED;
  }
  return first;
}

/** Numeric value of an Style dimension, or undefined when auto/percent/unset. */
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

  const nodes = root
    ? selection
        .filter((id) => id !== root.id)
        .map((id) => findNode(root, id))
        .filter((n): n is Node => !!n)
    : [];
  const primary = nodes[0];
  const multi = nodes.length > 1;

  // Batch an edit across every selected node as ONE undo entry; roll back fully
  // on validation failure. All writes go through the validated store actions.
  function batch(fn: (id: NodeId) => void) {
    const store = useDocumentStore.getState();
    try {
      setError(null);
      store.beginInteraction();
      for (const node of nodes) fn(node.id);
      store.commitInteraction();
    } catch (e) {
      store.cancelInteraction();
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const styleVal = <K extends keyof Style>(key: K): Maybe<Style[K]> =>
    shared(nodes, (n) => n.style[key]);
  const setStyle = (key: keyof Style, value: unknown) =>
    batch((id) => updateStyle(rootId!, id, { [key]: value }));
  const setDesignAll = (partial: Record<string, unknown>) =>
    batch((id) => updateDesign(rootId!, id, partial));
  const setPrimaryProp = (key: string, value: unknown) => {
    try {
      setError(null);
      updateProps(rootId!, primary.id, { [key]: value });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!root) {
    return (
      <Shell>
        <Empty>Select a frame to inspect.</Empty>
      </Shell>
    );
  }
  if (nodes.length === 0) {
    return (
      <Shell>
        <Empty>Select a layer to edit its properties.</Empty>
      </Shell>
    );
  }

  const allContainers = nodes.every((n) => canHaveChildren(n.type));
  const allText = nodes.every((n) => n.type === "Text");

  // Read helpers that collapse MIXED to an empty control with a mixed flag.
  const num = (key: keyof Style) => {
    const v = styleVal(key);
    return { value: isMixed(v) ? undefined : numeric(v), mixed: isMixed(v) };
  };
  const enumVal = <T,>(key: keyof Style, fallback?: T) => {
    const v = styleVal(key);
    return isMixed(v) ? undefined : ((v as T) ?? fallback);
  };
  const colorVal = (key: keyof Style) => {
    const v = styleVal(key);
    return isMixed(v) ? undefined : (v as string | undefined);
  };

  const position = enumVal<"relative" | "absolute">("position", "relative");
  const width = styleVal("width");
  const height = styleVal("height");

  return (
    <Shell>
      <SelectionHeader
        nodes={nodes}
        onName={(name) => setDesignAll({ name })}
        onLock={(locked) => setDesignAll({ locked })}
        onHide={(hidden) => setDesignAll({ hidden })}
      />

      <Section title="Layout">
        <Field label="Position">
          <SegmentedControl
            value={position}
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
              value={isMixed(width) ? undefined : numeric(width)}
              mixed={isMixed(width)}
              placeholder={isMixed(width) ? undefined : dimHint(width) ?? "auto"}
              min={0}
              onChange={(v) => setStyle("width", v)}
            />
          </Field>
          <Field label="Height">
            <NumberField
              label="H"
              value={isMixed(height) ? undefined : numeric(height)}
              mixed={isMixed(height)}
              placeholder={isMixed(height) ? undefined : dimHint(height) ?? "auto"}
              min={0}
              onChange={(v) => setStyle("height", v)}
            />
          </Field>
        </FieldGrid>
        {position === "absolute" && (
          <FieldGrid>
            <Field label="Left">
              <NumberField label="L" {...num("left")} onChange={(v) => setStyle("left", v)} />
            </Field>
            <Field label="Top">
              <NumberField label="T" {...num("top")} onChange={(v) => setStyle("top", v)} />
            </Field>
          </FieldGrid>
        )}
        <Field label="Padding">
          <NumberField label="P" {...num("padding")} min={0} onChange={(v) => setStyle("padding", v)} />
        </Field>
      </Section>

      {allContainers && (
        <Section title="Auto Layout">
          <Field label="Direction">
            <SegmentedControl
              value={enumVal<Style["flexDirection"]>("flexDirection", "column")}
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
            <Select value={enumVal<string>("justifyContent")} onChange={(v) => setStyle("justifyContent", v)} options={JUSTIFY_OPTIONS as never} placeholder="Start" />
          </Field>
          <Field label="Align">
            <Select value={enumVal<string>("alignItems")} onChange={(v) => setStyle("alignItems", v)} options={ALIGN_OPTIONS as never} placeholder="Stretch" />
          </Field>
          <FieldGrid>
            <Field label="Gap">
              <NumberField label="G" {...num("gap")} min={0} onChange={(v) => setStyle("gap", v)} />
            </Field>
            <Field label="Wrap">
              <SegmentedControl
                value={enumVal<Style["flexWrap"]>("flexWrap", "nowrap")}
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

      {allText && (
        <Section title="Typography">
          {!multi && primary.type === "Text" && (
            <Field label="Content" stacked>
              <TextField value={primary.props.text} onChange={(v) => setPrimaryProp("text", v)} placeholder="Text…" />
            </Field>
          )}
          <FieldGrid>
            <Field label="Size">
              <NumberField label="S" {...num("fontSize")} min={1} onChange={(v) => setStyle("fontSize", v)} />
            </Field>
            <Field label="Line height">
              <NumberField label="LH" {...num("lineHeight")} min={0} onChange={(v) => setStyle("lineHeight", v)} />
            </Field>
          </FieldGrid>
          <Field label="Weight">
            <Select value={enumVal<string>("fontWeight")} onChange={(v) => setStyle("fontWeight", v)} options={WEIGHT_OPTIONS as never} placeholder="Regular" />
          </Field>
          <Field label="Align">
            <SegmentedControl
              value={(() => {
                const a = enumVal<Style["textAlign"]>("textAlign", "left");
                return a && a !== "auto" ? a : a === undefined ? undefined : "left";
              })()}
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
            <ColorField value={colorVal("color")} onChange={(v) => setStyle("color", v)} />
          </Field>
        </Section>
      )}

      <Section title="Appearance">
        <Field label="Fill">
          <ColorField value={colorVal("backgroundColor")} onChange={(v) => setStyle("backgroundColor", v)} />
        </Field>
        <Field label="Opacity">
          <NumberField label="○" {...num("opacity")} min={0} max={1} step={0.05} onChange={(v) => setStyle("opacity", v)} />
        </Field>
        <FieldGrid>
          <Field label="Border width">
            <NumberField label="W" {...num("borderWidth")} min={0} onChange={(v) => setStyle("borderWidth", v)} />
          </Field>
          <Field label="Radius">
            <NumberField label="R" {...num("borderRadius")} min={0} onChange={(v) => setStyle("borderRadius", v)} />
          </Field>
        </FieldGrid>
        <Field label="Border color">
          <ColorField value={colorVal("borderColor")} onChange={(v) => setStyle("borderColor", v)} />
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
  nodes,
  onName,
  onLock,
  onHide,
}: {
  nodes: Node[];
  onName: (name: string) => void;
  onLock: (locked: boolean) => void;
  onHide: (hidden: boolean) => void;
}) {
  const multi = nodes.length > 1;
  const primary = nodes[0];
  const Icon = multi ? Boxes : TYPE_ICON[primary.type];
  const anyLocked = nodes.some((n) => n.design?.locked);
  const anyHidden = nodes.some((n) => n.design?.hidden);
  return (
    <div className="flex flex-col gap-sm border-b border-line px-md py-md">
      <div className="flex items-center gap-sm">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-chrome-2 text-ink-dim">
          <Icon size={15} aria-hidden="true" />
        </span>
        {multi ? (
          <span className="flex h-7 min-w-0 flex-1 items-center px-sm text-sm font-medium text-ink">
            {nodes.length} layers selected
          </span>
        ) : (
          <input
            value={primary.design?.name ?? ""}
            placeholder={primary.type}
            onChange={(e) => onName(e.target.value)}
            className="h-7 min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-sm text-sm font-medium text-ink transition-colors hover:border-line focus-visible:border-accent-line focus-visible:bg-chrome-2 focus-visible:outline-none"
          />
        )}
        <IconToggle title={anyLocked ? "Unlock" : "Lock"} pressed={anyLocked} onPressedChange={onLock}>
          {anyLocked ? <Lock size={14} aria-hidden="true" /> : <Unlock size={14} aria-hidden="true" />}
        </IconToggle>
        <IconToggle title={anyHidden ? "Show" : "Hide"} pressed={anyHidden} onPressedChange={onHide}>
          {anyHidden ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
        </IconToggle>
      </div>
      <div className="eyebrow pl-[2px]">
        {multi ? `${nodes.length} layers` : `${primary.type} · ${primary.id.slice(0, 8)}`}
      </div>
    </div>
  );
}
