import { useMemo, useState } from "react";
import {
  Check,
  Copy,
  FileCode2,
  FileJson2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { Eyebrow } from "./shell";
import { color } from "./studio-theme";
import {
  Button,
  Field,
  IconButton,
  Section,
  SegmentedControl,
  Select,
  StatusPill,
  TextField,
  cn,
} from "./studio-ui";
import type { RepoPanelContext } from "./repo-project-model";
import type { CodeArtifact, CodegenResult, GitStatus } from "./code-artifacts";
import { computeLineDiff, type DiffRow } from "./line-diff";

type ChangeStatus = "new" | "modified" | "unchanged";

type ChangeRow = {
  artifact: CodeArtifact;
  status: ChangeStatus;
  added: number;
  removed: number;
};

export type CodePanelProps = {
  repoBusy: boolean;
  codegenBusy: boolean;
  repoDraft: string;
  setRepoDraft: (value: string) => void;
  repoPath: string;
  repoContext: RepoPanelContext | null;
  workspaceFolderLabel: string;
  gitRepoLabel: string;
  repoError: string | null;
  onOpenDemo: () => void;
  onSelectFolder: () => void;
  onConnectPath: () => void;
  gitStatus: GitStatus;
  branchInfo: { current: string; branches: string[] };
  scopedChangeLabel: string;
  onRefreshGit: () => void;
  onSwitchBranch: (branch: string, create: boolean) => void;
  onCommit: (message: string) => void;
  onOpenPr: () => void;
  onForceSync: () => void;
  sidecarPath: string;
  setSidecarPath: (value: string) => void;
  onOpenSidecar: () => void;
  onImportSource: () => void;
  screenName: string;
  setScreenName: (value: string) => void;
  targetPath: string;
  setTargetPath: (value: string) => void;
  canCodegen: boolean;
  codegenError: string | null;
  codegenResult: CodegenResult | null;
  artifacts: CodeArtifact[];
  activeArtifactId: string;
  setActiveArtifactId: (id: string) => void;
  headByPath: Record<string, string>;
};

function iconForKind(kind: CodeArtifact["kind"]) {
  return kind === "json" ? FileJson2 : FileCode2;
}

function changeBarColor(status: ChangeStatus) {
  if (status === "new") return color.live;
  if (status === "modified") return color.accent;
  return color.line;
}

function lineCount(code: string) {
  return code === "" ? 0 : code.replace(/\n$/, "").split("\n").length;
}

// --- Restrained, on-palette syntax highlighting --------------------------------
// Two-tone: keywords accent, comments faint, numbers amber, strings dim, rest ink.
// Deliberately not a rainbow IDE theme — stays in the studio's chrome vocabulary.

const KEYWORDS = new Set([
  "import", "from", "export", "default", "const", "let", "var", "function",
  "return", "if", "else", "for", "while", "new", "await", "async", "type",
  "interface", "extends", "as", "of", "in", "typeof", "true", "false", "null",
  "undefined", "void",
]);

type Tok = { text: string; cls: string };

function tokenizeLine(text: string, kind: CodeArtifact["kind"]): Tok[] {
  const isCode = kind !== "json";
  const toks: Tok[] = [];
  let i = 0;
  const push = (t: string, cls: string) => t && toks.push({ text: t, cls });
  while (i < text.length) {
    const ch = text[i];
    if (isCode && ch === "/" && text[i + 1] === "/") {
      push(text.slice(i), "text-ink-faint italic");
      break;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) {
        if (text[j] === "\\") j++;
        j++;
      }
      push(text.slice(i, j + 1), "text-ink-dim");
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) && !/[A-Za-z_$]/.test(text[i - 1] ?? "")) {
      let j = i;
      while (j < text.length && /[0-9.]/.test(text[j])) j++;
      push(text.slice(i, j), "text-amber");
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_$]/.test(text[j])) j++;
      const word = text.slice(i, j);
      push(word, isCode && KEYWORDS.has(word) ? "text-accent" : "text-ink");
      i = j;
      continue;
    }
    push(ch, "text-ink");
    i++;
  }
  return toks;
}

function HiLine({ text, kind }: { text: string; kind: CodeArtifact["kind"] }) {
  const toks = useMemo(() => tokenizeLine(text, kind), [text, kind]);
  return (
    <>
      {toks.map((tok, index) => (
        <span key={index} className={tok.cls}>
          {tok.text}
        </span>
      ))}
    </>
  );
}

function FileLines({ code, kind }: { code: string; kind: CodeArtifact["kind"] }) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-canvas font-mono text-xs leading-[1.6]">
      {lines.map((line, index) => (
        <div key={index} className="flex">
          <span className="w-9 shrink-0 select-none border-r border-line-soft bg-chrome-2 pr-sm text-right text-ink-faint">
            {index + 1}
          </span>
          <span className="whitespace-pre pl-sm pr-md">
            <HiLine text={line || " "} kind={kind} />
          </span>
        </div>
      ))}
    </div>
  );
}

function DiffLines({ rows, kind }: { rows: DiffRow[]; kind: CodeArtifact["kind"] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-canvas font-mono text-xs leading-[1.6]">
      {rows.map((row, index) => {
        const marker = row.type === "add" ? "+" : row.type === "del" ? "-" : " ";
        return (
          <div
            key={index}
            className={cn(
              "flex",
              row.type === "add" && "bg-accent-soft",
              row.type === "del" && "bg-amber/10",
            )}
          >
            <span className="w-9 shrink-0 select-none border-r border-line-soft bg-chrome-2 pr-sm text-right text-ink-faint">
              {row.newNumber ?? row.oldNumber ?? ""}
            </span>
            <span
              className={cn(
                "w-4 shrink-0 select-none text-center",
                row.type === "add" && "text-accent",
                row.type === "del" && "text-amber",
                row.type === "context" && "text-ink-faint",
              )}
            >
              {marker}
            </span>
            <span className={cn("whitespace-pre pr-md", row.type === "del" && "opacity-70")}>
              <HiLine text={row.text || " "} kind={kind} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function CodePanel(props: CodePanelProps) {
  const {
    repoBusy,
    codegenBusy,
    repoDraft,
    setRepoDraft,
    repoPath,
    repoContext,
    workspaceFolderLabel,
    gitRepoLabel,
    repoError,
    onOpenDemo,
    onSelectFolder,
    onConnectPath,
    gitStatus,
    branchInfo,
    scopedChangeLabel,
    onRefreshGit,
    onSwitchBranch,
    onCommit,
    onOpenPr,
    onForceSync,
    sidecarPath,
    setSidecarPath,
    onOpenSidecar,
    onImportSource,
    screenName,
    setScreenName,
    targetPath,
    setTargetPath,
    canCodegen,
    codegenError,
    codegenResult,
    artifacts,
    activeArtifactId,
    setActiveArtifactId,
    headByPath,
  } = props;

  const [diffMode, setDiffMode] = useState<"diff" | "file">("diff");
  const [copied, setCopied] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [newBranch, setNewBranch] = useState<string | null>(null);

  const connected = Boolean(repoContext?.repoPath || repoPath);

  const changeRows = useMemo<ChangeRow[]>(() => {
    return artifacts.map((artifact) => {
      const head = headByPath[artifact.path];
      if (head == null) {
        return { artifact, status: "new", added: lineCount(artifact.code), removed: 0 };
      }
      const { added, removed } = computeLineDiff(head, artifact.code);
      return { artifact, status: added || removed ? "modified" : "unchanged", added, removed };
    });
  }, [artifacts, headByPath]);

  const changedCount = changeRows.filter((row) => row.status !== "unchanged").length;

  const activeArtifact =
    artifacts.find((artifact) => artifact.id === activeArtifactId) ?? artifacts[0] ?? null;
  const activeHead = activeArtifact ? headByPath[activeArtifact.path] : undefined;
  const activeDiff =
    activeArtifact && activeHead != null ? computeLineDiff(activeHead, activeArtifact.code) : null;
  const showDiff = diffMode === "diff" && activeDiff != null;

  async function copyActive() {
    if (!activeArtifact) return;
    try {
      await navigator.clipboard.writeText(activeArtifact.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  function submitCommit() {
    onCommit(commitMsg.trim() || `Update ${screenName}`);
    setCommitMsg("");
  }

  function confirmNewBranch() {
    const name = (newBranch ?? "").trim();
    if (name) onSwitchBranch(name, true);
    setNewBranch(null);
  }

  // First run: no repo. The panel is the connect step.
  if (!connected) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col gap-md overflow-auto p-md">
        <Eyebrow>Code</Eyebrow>
        <div className="flex flex-col gap-sm rounded-sm border border-line bg-chrome-2 p-md">
          <div className="text-sm font-medium text-ink">Connect a workspace</div>
          <p className="m-0 text-xs text-ink-faint">
            Open the demo repo or pick a folder to sync your canvas to code.
          </p>
          <div className="flex gap-xs">
            <Button className="flex-1" variant="primary" disabled={repoBusy || codegenBusy} onClick={onOpenDemo}>
              <Play size={14} aria-hidden="true" /> Open demo
            </Button>
            <Button className="flex-1" disabled={repoBusy || codegenBusy} onClick={onSelectFolder}>
              <FolderOpen size={14} aria-hidden="true" /> Select folder
            </Button>
          </div>
          <Field label="Workspace folder" stacked>
            <TextField
              value={repoDraft}
              onChange={setRepoDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") onConnectPath();
              }}
              placeholder="/path/to/app"
              spellCheck={false}
            />
          </Field>
          <Button disabled={repoBusy || codegenBusy || !repoDraft.trim()} onClick={onConnectPath}>
            Open path
          </Button>
          {repoError && <p className="m-0 text-xs text-amber">{repoError}</p>}
        </div>
      </div>
    );
  }

  const branchOptions = branchInfo.branches.map((b) => ({ value: b, label: b }));
  const currentBranch = branchInfo.current || repoContext?.designSession?.branch || "—";

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* A — header: branch + git status, the single source of repo truth */}
      <div className="flex flex-col gap-sm border-b border-line-soft p-md">
        <div className="flex items-center gap-xs">
          <Eyebrow>Code</Eyebrow>
          <div className="flex-1" />
          {codegenBusy ? (
            <StatusPill tone="accent">
              <Loader2 size={11} aria-hidden="true" className="animate-spin" /> Syncing
            </StatusPill>
          ) : (
            <StatusPill tone={changedCount > 0 ? "accent" : "neutral"}>
              {changedCount > 0 ? `${changedCount} changed` : "In sync"}
            </StatusPill>
          )}
        </div>

        {/* Branch — the single source of repo truth */}
        <div className="flex items-center gap-xs">
          <GitBranch size={14} aria-hidden="true" className="shrink-0 text-ink-faint" />
          {newBranch === null ? (
            <>
              <div className="min-w-0 flex-1">
                <Select
                  value={branchOptions.some((o) => o.value === currentBranch) ? currentBranch : undefined}
                  onChange={(branch) => onSwitchBranch(branch, false)}
                  options={branchOptions}
                  placeholder={currentBranch}
                />
              </div>
              <IconButton title="New studio branch" onClick={() => setNewBranch("")}>
                <Plus size={14} aria-hidden="true" />
              </IconButton>
              <IconButton title="Refresh Git status" onClick={onRefreshGit}>
                <RefreshCw size={14} aria-hidden="true" />
              </IconButton>
            </>
          ) : (
            <>
              <TextField
                value={newBranch}
                onChange={setNewBranch}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmNewBranch();
                  else if (e.key === "Escape") setNewBranch(null);
                }}
                placeholder="studio/new-branch"
                spellCheck={false}
              />
              <IconButton title="Create branch" onClick={confirmNewBranch}>
                <Check size={14} aria-hidden="true" />
              </IconButton>
              <IconButton title="Cancel" onClick={() => setNewBranch(null)}>
                <X size={14} aria-hidden="true" />
              </IconButton>
            </>
          )}
        </div>

        {/* Git handoff: commit / PR (the remaining human step) */}
        {changedCount > 0 ? (
          <div className="flex flex-col gap-xs">
            <div className="flex items-center gap-xs rounded-sm border border-line bg-chrome-2 py-2xs pl-sm pr-2xs">
              <input
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitCommit();
                }}
                placeholder={`Update ${screenName}`}
                spellCheck={false}
                className="h-6 min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
              />
              <Button variant="primary" className="h-6 shrink-0 px-sm" onClick={submitCommit}>
                <GitCommitHorizontal size={13} aria-hidden="true" /> Commit {changedCount}
              </Button>
            </div>
            <div className="flex items-center gap-md text-xs text-ink-faint">
              <button
                type="button"
                onClick={onOpenPr}
                className="inline-flex items-center gap-2xs transition-colors hover:text-ink"
              >
                <GitPullRequestArrow size={13} aria-hidden="true" /> Open PR
              </button>
              <button
                type="button"
                onClick={onForceSync}
                disabled={codegenBusy || !canCodegen}
                className="inline-flex items-center gap-2xs transition-colors hover:text-ink disabled:opacity-40"
              >
                <RefreshCw size={13} aria-hidden="true" /> Force sync
              </button>
              <span className="min-w-0 flex-1 truncate text-right text-ink-faint" title={workspaceFolderLabel}>
                {gitRepoLabel}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-md text-xs text-ink-faint">
            <span className="min-w-0 flex-1 truncate">
              {codegenResult ? "Committed — nothing to push." : "Live code will appear here."}
            </span>
            <button
              type="button"
              onClick={onOpenPr}
              className="inline-flex items-center gap-2xs transition-colors hover:text-ink"
            >
              <GitPullRequestArrow size={13} aria-hidden="true" /> PR
            </button>
            <button
              type="button"
              onClick={onForceSync}
              disabled={codegenBusy || !canCodegen}
              className="inline-flex items-center gap-2xs transition-colors hover:text-ink disabled:opacity-40"
            >
              <RefreshCw size={13} aria-hidden="true" /> Sync
            </button>
          </div>
        )}
        {(codegenError || repoError) && (
          <p className="m-0 rounded-sm border border-amber/40 bg-amber/10 px-sm py-xs text-xs text-amber">
            {codegenError ?? repoError}
          </p>
        )}
      </div>

      {/* C — change summary vs HEAD + diff viewer */}
      {codegenResult ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-2xs p-md pb-sm">
            <div className="mb-2xs flex items-baseline gap-xs">
              <Eyebrow>Changes</Eyebrow>
              <span className="text-2xs text-ink-faint">vs HEAD</span>
            </div>
            {changeRows.map((row) => {
              const active = row.artifact.id === activeArtifact?.id;
              const Icon = iconForKind(row.artifact.kind);
              return (
                <button
                  key={row.artifact.id}
                  type="button"
                  onClick={() => setActiveArtifactId(row.artifact.id)}
                  style={{ borderLeftColor: changeBarColor(row.status) }}
                  className={cn(
                    "flex h-8 w-full items-center gap-xs rounded-r-md border border-l-2 pl-sm pr-xs text-left text-xs transition-colors",
                    active
                      ? "border-accent-line bg-accent-soft text-accent"
                      : "border-line bg-chrome-2 text-ink-dim hover:bg-raised hover:text-ink",
                  )}
                >
                  <Icon size={14} aria-hidden="true" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{row.artifact.label}</span>
                  <span
                    className={cn(
                      "shrink-0 text-2xs",
                      row.status === "new" ? "text-live" : "text-ink-faint",
                    )}
                  >
                    {row.status === "new" ? "New" : row.status === "modified" ? "Modified" : "Unchanged"}
                  </span>
                  <span className="w-7 shrink-0 text-right font-mono text-accent">
                    {row.added > 0 ? `+${row.added}` : ""}
                  </span>
                  <span className="w-6 shrink-0 text-right font-mono text-amber">
                    {row.removed > 0 ? `−${row.removed}` : ""}
                  </span>
                </button>
              );
            })}
          </div>

          {activeArtifact && (
            <div className="mx-md mb-md flex min-h-[220px] flex-1 flex-col overflow-hidden rounded-md border border-line">
              <div className="flex items-center gap-xs border-b border-line-soft bg-chrome-2 px-sm py-xs text-xs">
                <span className="min-w-0 flex-1 truncate text-ink-dim" title={activeArtifact.path}>
                  {activeArtifact.path}
                </span>
                <span className="shrink-0 text-2xs uppercase tracking-wide text-ink-faint">
                  {activeArtifact.kind}
                </span>
              </div>
              <div className="flex items-center gap-xs border-b border-line bg-chrome-2 px-sm py-xs">
                <SegmentedControl<"diff" | "file">
                  value={diffMode}
                  onChange={setDiffMode}
                  options={[
                    { value: "diff", content: "Diff", title: "Diff vs HEAD" },
                    { value: "file", content: "File", title: "Full file" },
                  ]}
                />
                <span className="flex-1" />
                <IconButton title={copied ? "Copied" : "Copy file"} onClick={() => void copyActive()}>
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                </IconButton>
              </div>
              {diffMode === "diff" && activeDiff == null && (
                <div className="border-b border-line-soft bg-chrome-2 px-sm py-xs text-2xs text-ink-faint">
                  New file — not yet in {currentBranch}. Showing full contents.
                </div>
              )}
              {showDiff ? (
                <DiffLines rows={activeDiff!.rows} kind={activeArtifact.kind} />
              ) : (
                <FileLines code={activeArtifact.code} kind={activeArtifact.kind} />
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col p-md">
          <div className="flex flex-1 items-center justify-center rounded-sm border border-line bg-chrome-2 p-md text-center text-sm text-ink-faint">
            Open a screen to see its live code here.
          </div>
        </div>
      )}

      {/* D — setup demoted to a collapsed drawer */}
      <div className="border-t border-line-soft">
        <Section title="Workspace and output" defaultOpen={false}>
          <div className="flex gap-xs">
            <Button className="flex-1" disabled={repoBusy || codegenBusy} onClick={onOpenDemo}>
              <Play size={14} aria-hidden="true" /> Open demo
            </Button>
            <Button className="flex-1" disabled={repoBusy || codegenBusy} onClick={onSelectFolder}>
              <FolderOpen size={14} aria-hidden="true" /> Select folder
            </Button>
          </div>
          <Field label="Workspace folder" stacked>
            <TextField
              value={repoDraft}
              onChange={setRepoDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") onConnectPath();
                else if (e.key === "Escape") setRepoDraft(repoPath);
              }}
              placeholder="/path/to/app"
              spellCheck={false}
            />
          </Field>
          <Button disabled={repoBusy || codegenBusy || !repoDraft.trim()} onClick={onConnectPath}>
            Open path
          </Button>
          <div className="flex min-w-0 justify-between gap-sm text-xs">
            <span className="text-ink-faint">Changes</span>
            <span className="min-w-0 truncate text-ink" title={scopedChangeLabel}>
              {scopedChangeLabel}
            </span>
          </div>
          {repoContext?.designSession && (
            <div className="flex min-w-0 justify-between gap-sm text-xs">
              <span className="text-ink-faint">Writes to</span>
              <span className="min-w-0 truncate text-ink" title={repoContext.designSession.syncTarget}>
                {repoContext.designSession.syncTarget}
              </span>
            </div>
          )}
          <Field label="Sidecar" stacked>
            <TextField value={sidecarPath} onChange={setSidecarPath} />
          </Field>
          <div className="flex gap-xs">
            <Button className="flex-1" disabled={codegenBusy} onClick={onOpenSidecar}>
              <FolderOpen size={14} aria-hidden="true" /> Open
            </Button>
            <Button className="flex-1" disabled={codegenBusy} onClick={onImportSource}>
              <RefreshCw size={14} aria-hidden="true" /> Import
            </Button>
          </div>
          <Field label="Screen" stacked>
            <TextField value={screenName} onChange={setScreenName} />
          </Field>
          <Field label="Code path" stacked>
            <TextField value={targetPath} onChange={setTargetPath} />
          </Field>
        </Section>
      </div>
    </div>
  );
}
