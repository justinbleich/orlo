import {
  type ComponentDefinition,
  type ComponentProp,
  type Node,
  type NodeId,
  type PressableNode,
  type VariantCombination,
} from "@rn-canvas/document";

export type CreationPreset = "none" | "button" | "card";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function childrenOf(node: Node): Node[] {
  return "children" in node && Array.isArray(node.children) ? node.children : [];
}

function walk(node: Node, result: Node[] = []): Node[] {
  result.push(node);
  for (const child of childrenOf(node)) walk(child, result);
  return result;
}

function uniquePropName(base: string, props: ComponentProp[]): string {
  const taken = new Set(props.map((prop) => prop.name));
  let name = base;
  for (let i = 2; taken.has(name); i += 1) name = `${base}${i}`;
  return name;
}

function withProp(definition: ComponentDefinition, prop: ComponentProp): ComponentDefinition {
  return { ...definition, props: [...definition.props, prop] };
}

function firstTextNode(definition: ComponentDefinition): Node | undefined {
  return walk(definition.template).find((node) => node.type === "Text");
}

function textNodes(definition: ComponentDefinition): Node[] {
  return walk(definition.template).filter((node) => node.type === "Text");
}

function darkerHex(hex: string | undefined, fallback: string, amount: number): string {
  const source = /^#[0-9a-fA-F]{6}$/.test(hex ?? "") ? hex! : fallback;
  const value = Number.parseInt(source.slice(1), 16);
  const r = Math.max(0, Math.round(((value >> 16) & 255) * amount));
  const g = Math.max(0, Math.round(((value >> 8) & 255) * amount));
  const b = Math.max(0, Math.round((value & 255) * amount));
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function isNeutralPressableFill(value: unknown): boolean {
  return value === undefined || value === "#FFFFFF" || value === "#ffffff" || value === "white";
}

function isNeutralPressableBorder(width: unknown, color: unknown): boolean {
  return width === 1 && (color === "#CBD5E1" || color === "#cbd5e1");
}

function buttonPreset(definition: ComponentDefinition): ComponentDefinition {
  if (definition.template.type !== "Pressable") return definition;
  let next = clone(definition);
  const root = next.template as PressableNode;
  const shouldReplaceBorder = isNeutralPressableBorder(root.style.borderWidth, root.style.borderColor);
  root.style = {
    borderRadius: root.style.borderRadius ?? 12,
    minHeight: root.style.minHeight ?? 44,
    padding: root.style.padding ?? 12,
    alignItems: root.style.alignItems ?? "center",
    justifyContent: root.style.justifyContent ?? "center",
    ...root.style,
    backgroundColor: isNeutralPressableFill(root.style.backgroundColor)
      ? "#2563EB"
      : root.style.backgroundColor,
    borderWidth: shouldReplaceBorder ? 0 : root.style.borderWidth,
  };
  const label = firstTextNode(next);
  if (label) {
    if (label.type === "Text") {
      label.style = {
        fontWeight: label.style.fontWeight ?? "600",
        textAlign: label.style.textAlign ?? "center",
        ...label.style,
        color: "#FFFFFF",
      };
    }
    next = withProp(next, {
      name: uniquePropName("label", next.props),
      valueType: "string",
      default: label.type === "Text" ? label.props.text : "Button",
      targets: [{ kind: "prop", nodeId: label.id, path: "text" }],
    });
  }
  next = withProp(next, {
    name: uniquePropName("disabled", next.props),
    valueType: "boolean",
    default: false,
    targets: [{ kind: "prop", nodeId: root.id, path: "disabled" }],
  });

  const baseFill = typeof root.style.backgroundColor === "string"
    ? root.style.backgroundColor
    : "#2563EB";
  const combinations: VariantCombination[] = [
    {
      values: { state: "hover" },
      overrides: [{ nodeId: root.id, style: { backgroundColor: darkerHex(baseFill, "#2563EB", 0.9) } }],
    },
    {
      values: { state: "pressed" },
      overrides: [{ nodeId: root.id, style: { backgroundColor: darkerHex(baseFill, "#2563EB", 0.78) } }],
    },
    {
      values: { state: "disabled" },
      overrides: [{ nodeId: root.id, style: { opacity: 0.5 } }],
    },
  ];

  return {
    ...next,
    variants: [{ name: "state", values: ["default", "hover", "pressed", "disabled"] }],
    combinations,
  };
}

function cardPreset(definition: ComponentDefinition): ComponentDefinition {
  if (definition.template.type !== "View") return definition;
  let next = clone(definition);
  next.template.style = {
    backgroundColor: next.template.style.backgroundColor ?? "#FFFFFF",
    borderRadius: next.template.style.borderRadius ?? 12,
    padding: next.template.style.padding ?? 16,
    ...next.template.style,
  };
  const [title, subtitle] = textNodes(next);
  if (title) {
    next = withProp(next, {
      name: uniquePropName("title", next.props),
      valueType: "string",
      default: title.type === "Text" ? title.props.text : "Title",
      targets: [{ kind: "prop", nodeId: title.id, path: "text" }],
    });
  }
  if (subtitle) {
    next = withProp(next, {
      name: uniquePropName("subtitle", next.props),
      valueType: "string",
      default: subtitle.type === "Text" ? subtitle.props.text : "Subtitle",
      targets: [{ kind: "prop", nodeId: subtitle.id, path: "text" }],
    });
  }
  return withProp(next, {
    name: uniquePropName("background", next.props),
    valueType: "color",
    default: typeof next.template.style.backgroundColor === "string"
      ? next.template.style.backgroundColor
      : "#FFFFFF",
    targets: [{ kind: "style", nodeId: next.template.id, styleKey: "backgroundColor" }],
  });
}

export function applyCreationPreset(
  definition: ComponentDefinition,
  preset: CreationPreset,
): ComponentDefinition {
  if (preset === "button") return buttonPreset(definition);
  if (preset === "card") return cardPreset(definition);
  return definition;
}

export function supportedCreationPresets(nodeType: string): CreationPreset[] {
  const presets: CreationPreset[] = ["none"];
  if (nodeType === "Pressable") presets.push("button");
  if (nodeType === "View") presets.push("card");
  return presets;
}
