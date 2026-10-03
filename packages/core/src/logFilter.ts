/**
 * Raw-log filtering (M3.6). Pure line helpers: text search (multi-word AND,
 * case-insensitive) plus an errors-only toggle for triage.
 */

const ERROR_RE = /error|fail|warn|exception|traceback/i;

/** True when a log line looks like an error/warning for the errors-only toggle. */
export function isErrorLine(line: string): boolean {
  return ERROR_RE.test(line);
}

function matchesQuery(line: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  const hay = line.toLowerCase();
  return q
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .every((w) => hay.includes(w));
}

/** Lines to display for the given search text + errors-only flag. */
export function filterLogLines(
  text: string,
  query: string,
  errorsOnly: boolean,
): string[] {
  const lines = text.split(/\r?\n/);
  return lines.filter(
    (line) => (!errorsOnly || isErrorLine(line)) && matchesQuery(line, query),
  );
}

/** Count of displayed lines (for the match-count status line). */
export function countLogMatches(text: string, query: string, errorsOnly: boolean): number {
  return filterLogLines(text, query, errorsOnly).length;
}
