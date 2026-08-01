/**
 * Deterministic ZIP writer (PRD §23.5, design §23.5).
 *
 * Archives built from the same entries + SOURCE_DATE_EPOCH are byte-identical:
 * entries are sorted lexicographically, every entry uses the same fixed DOS
 * timestamp, deflate compression is deterministic, and no host path or
 * ownership metadata is recorded. Used by build-local-ai-runtime.mjs so two CI
 * runs over the same runtime closure + commit time reproduce the same bytes
 * (modulo macOS release re-signing).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import CRC32 from "crc-32";

const SIGNATURE_LOCAL = 0x04034b50;
const SIGNATURE_CENTRAL = 0x02014b50;
const SIGNATURE_EOCD = 0x06054b50;

/** Convert a unix epoch (seconds) to DOS time/date fields. */
export function dosDateTime(epochSeconds) {
  const safe = epochSeconds && epochSeconds > 0 ? epochSeconds : 315532800; // 1980-01-01
  const d = new Date(safe * 1000);
  const year = Math.max(1980, d.getUTCFullYear());
  const dosTime =
    ((d.getUTCHours() & 0x1f) << 11) |
    ((d.getUTCMinutes() & 0x3f) << 5) |
    (Math.floor(d.getUTCSeconds() / 2) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((d.getUTCMonth() + 1) & 0x0f) << 5) |
    (d.getUTCDate() & 0x1f);
  return { time: dosTime, date: dosDate };
}

/**
 * Build deterministic ZIP bytes from a list of {name, data} entries.
 * @param {Array<{name: string, data: Buffer}>} entries
 * @param {{ sourceDateEpoch?: number }} options
 * @returns {Buffer}
 */
export function buildDeterministicZipBytes(entries, options = {}) {
  const epoch = options.sourceDateEpoch ?? Number(process.env.SOURCE_DATE_EPOCH ?? 0);
  const { time, date } = dosDateTime(epoch);

  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const localChunks = [];
  const centralRecords = [];
  let offset = 0;

  for (const entry of sorted) {
    const nameBuf = Buffer.from(entry.name, "utf-8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = CRC32.buf(data) >>> 0;
    const compressed = deflateRawSync(data);
    const isStored = compressed.length >= data.length;
    const method = isStored ? 0 : 8;
    const payload = isStored ? data : compressed;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIGNATURE_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localChunks.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIGNATURE_CENTRAL, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centralRecords.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const cd = Buffer.concat(centralRecords);
  const cdOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIGNATURE_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(sorted.length, 8);
  eocd.writeUInt16LE(sorted.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, cd, eocd]);
}

/** Write a deterministic ZIP to `outputPath` (creating parent dirs). */
export function writeDeterministicZip(outputPath, entries, options = {}) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const bytes = buildDeterministicZipBytes(entries, options);
  writeFileSync(outputPath, bytes);
  return bytes.length;
}
