//split array into groups
export function SplitArrayIntoGroups<Type>(
  array: Type[],
  groupSize: number
): Type[][] {
  const groups: Type[][] = [];
  for (let i = 0; i < array.length; i += groupSize) {
    // array.slice(i, i + groupSize)
    groups.push(array.slice(i, i + groupSize));
  }
  return groups;
}

const StringIsNumber = (value) => isNaN(Number(value)) === false;
export function ToArray(enumme) {
  return Object.keys(enumme)
    .filter(StringIsNumber)
    .map((key) => enumme[key]);
}
export function CapitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}
export function convertNumberToBoolean(num: number): boolean {
  return num !== 0;
}
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Format a send-log record time for display in the user's local timezone.
 *
 * The unified send log merges two data sources with different raw shapes:
 *   - legacy half (emailmarketing_send_log): local-naive "YYYY-MM-DD HH:mm:ss"
 *   - authorized half (outbound_email_delivery_outcome): UTC ISO (toISOString)
 * `new Date()` parses both shapes correctly (naive → local, ISO → UTC-shifted),
 * so toLocaleString() displays both in the user's computer timezone. Missing
 * values render as a placeholder; unparseable values fall back to the raw
 * string so users still see what was stored.
 */
export function formatRecordTime(value: string | undefined): string {
  if (!value) return "—";
  try {
    const date = new Date(value);
    // Unparseable input yields an Invalid Date (no throw) whose
    // toLocaleString() is "Invalid Date" — fall back to the raw string.
    if (isNaN(date.getTime())) return value;
    return date.toLocaleString();
  } catch {
    return value;
  }
}
