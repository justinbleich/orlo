import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import type { FlowEdge } from "./src/repo-contract";

type RepoScreenCandidate = {
  path: string;
  name: string;
  kind: "source" | "sidecar";
  sidecarPath?: string;
  routeKind: "expo-router" | "react-navigation" | "unknown";
  rnCanvas: boolean;
};

type RepoSidecarCandidate = {
  path: string;
  screenName?: string;
  targetPath?: string;
};

export type RepoFlowGraphCandidate = {
  id: string;
  label: string;
  description: string;
  routeKind: RepoScreenCandidate["routeKind"];
  screenPaths: string[];
  entryPath?: string;
  edges: Array<{
    fromPath: string;
    toPath: string;
    kind: FlowEdge["kind"];
    condition?: string;
    anchorNodeId?: string;
  }>;
};

function titleFromRouteSegment(segment: string) {
  const clean = segment
    .replace(/^\((.+)\)$/, "$1")
    .replace(/^\[(.+)\]$/, "$1")
    .replace(/\.[^.]+$/, "");
  const words = clean
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter(Boolean);
  if (words.length === 0) return clean || "Untitled";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function slugId(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "flow";
}

function routePartsForPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "src" && parts[1] === "app") return parts.slice(2);
  if (parts[0] === "app") return parts.slice(1);
  return parts;
}

function routePathForExpoFile(path: string) {
  const parts = routePartsForPath(path);
  const last = parts[parts.length - 1];
  if (!last) return "/";
  const fileBase = last.replace(/\.[^.]+$/, "");
  if (fileBase === "_layout" || fileBase.startsWith("+")) return undefined;
  const segments = [...parts.slice(0, -1), fileBase]
    .filter((part) => !part.startsWith("("))
    .filter((part) => part !== "index")
    .map((part) => part.replace(/^\[(.+)\]$/, ":$1"));
  return `/${segments.join("/")}`.replace(/\/+$/, "") || "/";
}

function flowSegmentForPath(path: string) {
  const parts = routePartsForPath(path).filter((part) => !part.startsWith("("));
  if (parts.length < 2) return undefined;
  const segment = parts[0];
  if (!segment || segment === "index" || segment === "generated") return undefined;
  return segment;
}

function staticString(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node) && node.expression) return staticString(node.expression);
  return undefined;
}

function propertyNameText(name: ts.PropertyName | ts.MemberName | undefined) {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function enclosingCondition(node: ts.Node, source: ts.SourceFile) {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isIfStatement(current)) return current.expression.getText(source);
    if (ts.isConditionalExpression(current)) return current.condition.getText(source);
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return current.left.getText(source);
    }
    current = current.parent;
  }
  return undefined;
}

type SidecarNode = { id?: string; type?: string; children?: SidecarNode[] };

function flattenSidecarNodes(node: SidecarNode | undefined, out: SidecarNode[] = []) {
  if (!node) return out;
  out.push(node);
  for (const child of node.children ?? []) flattenSidecarNodes(child, out);
  return out;
}

async function sidecarNodesByType(repoRoot: string, sidecarPath?: string) {
  if (!sidecarPath) return new Map<string, string[]>();
  try {
    const raw = await readFile(join(repoRoot, sidecarPath), "utf8");
    const parsed = JSON.parse(raw) as { root?: SidecarNode };
    const map = new Map<string, string[]>();
    for (const node of flattenSidecarNodes(parsed.root)) {
      if (!node.type || !node.id) continue;
      const bucket = map.get(node.type) ?? [];
      bucket.push(node.id);
      map.set(node.type, bucket);
    }
    return map;
  } catch {
    return new Map<string, string[]>();
  }
}

function enclosingJsxTagName(node: ts.Node) {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      return current.openingElement.tagName.getText();
    }
    if (ts.isJsxSelfClosingElement(current)) {
      return current.tagName.getText();
    }
    current = current.parent;
  }
  return undefined;
}

function countPriorJsxTags(source: ts.SourceFile, tagName: string, position: number) {
  let count = 0;
  function visit(node: ts.Node) {
    if (node.getStart(source) >= position) return;
    if (
      (ts.isJsxElement(node) && node.openingElement.tagName.getText() === tagName) ||
      (ts.isJsxSelfClosingElement(node) && node.tagName.getText() === tagName)
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return Math.max(0, count - 1);
}

function resolveHref(href: string, currentPath: string, routeByHref: Map<string, string>) {
  const clean = href.split(/[?#]/)[0] || "/";
  const absolute = clean.startsWith("/")
    ? clean
    : `${routePathForExpoFile(currentPath)?.replace(/\/[^/]*$/, "") ?? ""}/${clean}`;
  const normalized = absolute.replace(/\/+/g, "/").replace(/\/+$/, "") || "/";
  return routeByHref.get(normalized);
}

export async function inferRepoFlowsFromNavigation(
  repoRoot: string,
  screens: RepoScreenCandidate[],
  sidecars: RepoSidecarCandidate[],
): Promise<RepoFlowGraphCandidate[]> {
  const routeScreens = screens.filter((screen) => screen.routeKind === "expo-router");
  const routeByHref = new Map<string, string>();
  for (const screen of routeScreens) {
    const routePath = routePathForExpoFile(screen.path);
    if (routePath) routeByHref.set(routePath, screen.path);
  }
  const sidecarByTarget = new Map(sidecars.map((sidecar) => [sidecar.targetPath, sidecar.path]));
  const edges: RepoFlowGraphCandidate["edges"] = [];

  for (const screen of routeScreens) {
    const routePath = routePathForExpoFile(screen.path);
    if (!routePath) continue;
    let sourceText = "";
    try {
      sourceText = await readFile(join(repoRoot, screen.path), "utf8");
    } catch {
      continue;
    }
    const source = ts.createSourceFile(screen.path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const sidecarPath = screen.sidecarPath ?? sidecarByTarget.get(screen.path);
    const byType = await sidecarNodesByType(repoRoot, sidecarPath);

    function anchorFor(node: ts.Node) {
      const tag = enclosingJsxTagName(node);
      if (!tag) return undefined;
      const ids = byType.get(tag);
      if (!ids || ids.length === 0) return undefined;
      return ids[countPriorJsxTags(source, tag, node.getStart(source))];
    }

    function record(toHref: string | undefined, callNode: ts.Node, defaultKind: FlowEdge["kind"]) {
      if (!toHref) return;
      const toPath = resolveHref(toHref, screen.path, routeByHref);
      if (!toPath || toPath === screen.path) return;
      const condition = enclosingCondition(callNode, source);
      edges.push({
        fromPath: screen.path,
        toPath,
        kind: condition ? "conditional" : defaultKind,
        condition,
        anchorNodeId: anchorFor(callNode),
      });
    }

    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        if (ts.isPropertyAccessExpression(expression)) {
          const method = propertyNameText(expression.name);
          if (method === "push" || method === "replace" || method === "navigate") {
            record(node.arguments[0] ? staticString(node.arguments[0]) : undefined, node, "primary");
          }
        }
      }
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = node.tagName.getText();
        if (tag === "Link" || tag === "Redirect") {
          const href = node.attributes.properties.find(
            (prop): prop is ts.JsxAttribute =>
              ts.isJsxAttribute(prop) && prop.name.text === "href",
          );
          record(href?.initializer ? staticString(href.initializer) : undefined, node, tag === "Redirect" ? "conditional" : "primary");
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }

  const groups = new Map<string, RepoScreenCandidate[]>();
  for (const screen of routeScreens) {
    const segment = flowSegmentForPath(screen.path);
    if (!segment) continue;
    const group = groups.get(segment) ?? [];
    group.push(screen);
    groups.set(segment, group);
  }

  return [...groups.entries()].map(([segment, groupScreens]) => {
    const paths = groupScreens.map((screen) => screen.path);
    const pathSet = new Set(paths);
    const label = titleFromRouteSegment(segment);
    const entryPath = paths.find((path) => /\/index\.[tj]sx$/.test(path)) ?? paths[0];
    return {
      id: `repo-flow:${slugId(segment)}`,
      label,
      description: `${label} journey inferred from repo navigation.`,
      routeKind: "expo-router",
      screenPaths: paths,
      entryPath,
      edges: edges.filter((edge) => pathSet.has(edge.fromPath) && pathSet.has(edge.toPath)),
    };
  });
}
