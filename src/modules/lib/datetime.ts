/**
 * Date/time formatting utilities — extracted from lib/function.ts (R5.6).
 * Pure string formatting, no external dependencies.
 */

/** Zero-pad a number to 2 digits. */
export function pad2(n: number): string {
  if (n < 10) {
    return "0" + n.toString();
  } else {
    return n.toString();
  }
}

/** Get a formatted record timestamp for the local DB (YYYY-MM-DD HH:mm:ss). */
export function getRecorddatetime(): string {
  const date = new Date();
  return (
    date.getFullYear().toString() +
    "-" +
    pad2(date.getMonth() + 1) +
    "-" +
    pad2(date.getDate()) +
    " " +
    pad2(date.getHours()) +
    ":" +
    pad2(date.getMinutes()) +
    ":" +
    pad2(date.getSeconds())
  );
}

/** Get a formatted date string (same format as getRecorddatetime). */
export function getdate(): string {
  const date = new Date();
  return (
    date.getFullYear().toString() +
    "-" +
    pad2(date.getMonth() + 1) +
    "-" +
    pad2(date.getDate()) +
    " " +
    pad2(date.getHours()) +
    ":" +
    pad2(date.getMinutes()) +
    ":" +
    pad2(date.getSeconds())
  );
}
