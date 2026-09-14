export interface DiffOp {
  type: 'same' | 'del' | 'ins';
  line: string;
}

interface DiffHunk {
  header: string;
  ops: DiffOp[];
}

const CONTEXT_LINES = 3;

export function createUnifiedDiff(
  path: string,
  original: string,
  patched: string,
): string {
  const oldLines = splitLines(original);
  const newLines = splitLines(patched);
  const ops = diffLines(oldLines, newLines);

  if (!ops.some((op) => op.type !== 'same')) return '';

  const chunks: Array<{ from: number; to: number }> = [];
  let current: { from: number; to: number } | undefined;

  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i].type === 'same') continue;
    if (current === undefined) {
      current = { from: i, to: i };
    } else if (i - current.to <= CONTEXT_LINES * 2) {
      current.to = i;
    } else {
      chunks.push(current);
      current = { from: i, to: i };
    }
  }
  if (current !== undefined) chunks.push(current);

  const body: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (const chunk of chunks) {
    const hunks: DiffHunk[] = [];
    const from = Math.max(0, chunk.from - CONTEXT_LINES);
    const to = Math.min(ops.length, chunk.to + 1 + CONTEXT_LINES);
    hunks.push({
      header: buildHunkHeader(ops, from, to),
      ops: ops.slice(from, to),
    });
    for (const hunk of hunks) {
      body.push(hunk.header);
      for (const op of hunk.ops) {
        const prefix = op.type === 'same' ? ' ' : op.type === 'del' ? '-' : '+';
        body.push(prefix + op.line);
      }
    }
  }
  return body.join('\n');
}

function buildHunkHeader(ops: DiffOp[], from: number, to: number): string {
  const segment = ops.slice(from, to);
  const oldCount = segment.filter((op) => op.type !== 'ins').length;
  const newCount = segment.filter((op) => op.type !== 'del').length;
  const oldStart =
    ops.slice(0, from).filter((op) => op.type !== 'ins').length + 1;
  const newStart =
    ops.slice(0, from).filter((op) => op.type !== 'del').length + 1;
  return `@@ -${formatCount(oldStart, oldCount)} +${formatCount(newStart, newCount)} @@`;
}

function formatCount(start: number, count: number): string {
  if (count === 0) return `${start},0`;
  return count === 1 ? `${start}` : `${start},${count}`;
}

function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function diffLines(a: string[], b: string[]): DiffOp[] {
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', line: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', line: a[i] });
      i += 1;
    } else {
      ops.push({ type: 'ins', line: b[j] });
      j += 1;
    }
  }
  while (i < m) {
    ops.push({ type: 'del', line: a[i] });
    i += 1;
  }
  while (j < n) {
    ops.push({ type: 'ins', line: b[j] });
    j += 1;
  }
  return ops;
}