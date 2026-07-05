/**
 * Minimal LCS line diff. Generated screens/sidecars are small, so an O(n·m) DP
 * table is fine. Produces a unified row list with old/new line numbers plus
 * add/remove counts for the change summary. Chrome-only helper — no React.
 */

export type DiffRow = {
  type: "context" | "add" | "del";
  text: string;
  oldNumber?: number;
  newNumber?: number;
};

export type LineDiff = {
  rows: DiffRow[];
  added: number;
  removed: number;
};

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\n$/, "").split("\n");
}

export function computeLineDiff(oldText: string, newText: string): LineDiff {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const n = oldLines.length;
  const m = newLines.length;

  // dp[i][j] = length of the LCS of oldLines[i:] and newLines[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      rows.push({ type: "context", text: oldLines[i], oldNumber: oldNo++, newNumber: newNo++ });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "del", text: oldLines[i], oldNumber: oldNo++ });
      removed++;
      i++;
    } else {
      rows.push({ type: "add", text: newLines[j], newNumber: newNo++ });
      added++;
      j++;
    }
  }
  while (i < n) {
    rows.push({ type: "del", text: oldLines[i], oldNumber: oldNo++ });
    removed++;
    i++;
  }
  while (j < m) {
    rows.push({ type: "add", text: newLines[j], newNumber: newNo++ });
    added++;
    j++;
  }

  return { rows, added, removed };
}
