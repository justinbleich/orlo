/**
 * Shared codegen/git types + pure helpers used by both App and the CodePanel.
 * Chrome-only data shaping — no React, no rendering.
 */

export type CodegenResult = {
  screenName: string;
  code: string;
  sidecar: string;
  targetPath: string;
  sidecarPath: string;
  components?: { name: string; fileName: string; code: string }[];
  componentPaths?: string[];
  theme?: { fileName: string; code: string };
  themePath?: string;
  wrote?: boolean;
};

export type CodeArtifact = {
  id: string;
  label: string;
  path: string;
  kind: "tsx" | "json" | "theme";
  code: string;
};

export type GitFileStatus = {
  path: string;
  index: string;
  workingTree: string;
};

export type GitStatus =
  | { status: "loading" }
  | { status: "ready"; repoPath: string; branch: string; clean: boolean; files: GitFileStatus[] }
  | { status: "error"; message: string };

export function codeArtifacts(result: CodegenResult | null): CodeArtifact[] {
  if (!result) return [];
  const artifacts: CodeArtifact[] = [
    {
      id: "screen",
      label: result.targetPath.split("/").pop() ?? result.targetPath,
      path: result.targetPath,
      kind: "tsx",
      code: result.code,
    },
    {
      id: "document",
      label: result.sidecarPath.split("/").pop() ?? result.sidecarPath,
      path: result.sidecarPath,
      kind: "json",
      code: result.sidecar,
    },
  ];
  if (result.theme) {
    artifacts.push({
      id: "theme",
      label: result.theme.fileName,
      path: result.themePath ?? result.theme.fileName,
      kind: "theme",
      code: result.theme.code,
    });
  }
  result.components?.forEach((component, index) => {
    artifacts.push({
      id: `component-${index}-${component.name}`,
      label: component.fileName,
      path: result.componentPaths?.[index] ?? `components/${component.fileName}`,
      kind: "tsx",
      code: component.code,
    });
  });
  return artifacts;
}

export function gitFileStatusLabel(file: GitFileStatus): string {
  const code = `${file.index}${file.workingTree}`;
  if (code === "??") return "Untracked";
  if (file.workingTree === "M" || file.index === "M") return "Modified";
  if (file.workingTree === "D" || file.index === "D") return "Deleted";
  if (file.workingTree === "A" || file.index === "A") return "Added";
  if (file.workingTree === "R" || file.index === "R") return "Renamed";
  return code.trim() || "Changed";
}

/** Baseline snapshot of a codegen result keyed by output path (last-synced content). */
export function baselineFromResult(result: CodegenResult): Record<string, string> {
  const map: Record<string, string> = {};
  for (const artifact of codeArtifacts(result)) map[artifact.path] = artifact.code;
  return map;
}
