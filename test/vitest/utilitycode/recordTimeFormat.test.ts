import { describe, expect, test } from "vitest";
import { formatRecordTime } from "@/views/utils/function";

/**
 * formatRecordTime renders send-log record times in the user's local
 * timezone. The unified send log merges two data sources with different
 * raw shapes:
 *   - legacy half (emailmarketing_send_log): local-naive "YYYY-MM-DD HH:mm:ss"
 *   - authorized half (outbound_email_delivery_outcome): UTC ISO (toISOString)
 * `new Date()` parses both shapes correctly (naive → local, ISO → UTC-shifted),
 * so toLocaleString() displays both in local time.
 */
describe("formatRecordTime", () => {
  test("returns an em-dash placeholder for missing values", () => {
    expect(formatRecordTime(undefined)).toBe("—");
    expect(formatRecordTime("")).toBe("—");
  });

  test("formats an authorized-half UTC ISO record time in the local timezone", () => {
    const iso = "2026-09-02T00:00:00.000Z";
    expect(formatRecordTime(iso)).toBe(new Date(iso).toLocaleString());
  });

  test("formats a legacy-half local-naive record time", () => {
    const naive = "2026-09-01 08:30:00";
    expect(formatRecordTime(naive)).toBe(new Date(naive).toLocaleString());
  });

  test("returns the raw value when it cannot be parsed as a date", () => {
    expect(formatRecordTime("not a date")).toBe("not a date");
  });
});
