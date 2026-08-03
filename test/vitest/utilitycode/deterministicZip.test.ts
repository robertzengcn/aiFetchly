import { describe, expect, test } from "vitest";
import AdmZip from "adm-zip";
import {
  buildDeterministicZipBytes,
  dosDateTime,
} from "../../../scripts/lib/localAiRuntime/deterministicZip.mjs";

describe("dosDateTime", () => {
  test("zero/negative input floors to 1980-01-01 (midnight UTC)", () => {
    // The ZIP epoch floor is 1980-01-01; dos time at midnight is 0 and the
    // encoded date is (0<<9)|(1<<5)|1 = 33.
    expect(dosDateTime(0)).toEqual({ time: 0, date: 33 });
    expect(dosDateTime(-5)).toEqual({ time: 0, date: 33 });
    expect(dosDateTime(315532800)).toEqual({ time: 0, date: 33 });
  });
});

describe("buildDeterministicZipBytes", () => {
  const entries = [
    { name: "node_modules/b/package.json", data: Buffer.from('{"name":"b"}') },
    { name: "node_modules/a/package.json", data: Buffer.from('{"name":"a"}') },
    { name: "manifest.json", data: Buffer.from("{}") },
  ];

  test("round-trips through a standard ZIP reader", () => {
    const bytes = buildDeterministicZipBytes(entries, {
      sourceDateEpoch: 315532800,
    });
    const zip = new AdmZip(bytes);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names.sort()).toEqual(
      [
        "manifest.json",
        "node_modules/a/package.json",
        "node_modules/b/package.json",
      ].sort()
    );
    const a = zip.getEntry("node_modules/a/package.json");
    expect(a?.getData().toString()).toBe('{"name":"a"}');
  });

  test("is deterministic: identical input + epoch → identical bytes", () => {
    const b1 = buildDeterministicZipBytes(entries, {
      sourceDateEpoch: 1700000000,
    });
    const b2 = buildDeterministicZipBytes(entries, {
      sourceDateEpoch: 1700000000,
    });
    expect(Buffer.compare(b1, b2)).toBe(0);
  });

  test("input order does not affect output (entries are sorted)", () => {
    const reversed = [...entries].reverse();
    const a = buildDeterministicZipBytes(entries, {
      sourceDateEpoch: 1700000000,
    });
    const b = buildDeterministicZipBytes(reversed, {
      sourceDateEpoch: 1700000000,
    });
    expect(Buffer.compare(a, b)).toBe(0);
  });

  test("different epoch produces different bytes (timestamp changes)", () => {
    const a = buildDeterministicZipBytes(entries, {
      sourceDateEpoch: 1700000000,
    });
    const b = buildDeterministicZipBytes(entries, {
      sourceDateEpoch: 1750000000,
    });
    expect(Buffer.compare(a, b)).not.toBe(0);
  });
});
