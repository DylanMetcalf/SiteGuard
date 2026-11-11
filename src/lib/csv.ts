/** One CSV cell, quoted. A cell that starts with = + - @ (or a tab/return) is prefixed with ' so a spreadsheet cannot run it as a formula. */
export function csvCell(v: unknown): string {
  let t = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return '"' + t.replace(/"/g, '""') + '"';
}
