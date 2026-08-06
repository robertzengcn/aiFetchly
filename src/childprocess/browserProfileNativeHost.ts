import { nativeMessageSchema, NATIVE_MESSAGE_MAX_BYTES } from "@/schemas/nativeMessaging";
import type { NativeMessage } from "@/schemas/nativeMessaging";
import { log } from "@/modules/Logger";

/**
 * Chromium native-messaging host entry point (technical design §9.5–§9.6).
 *
 * SECURITY POSTURE: this process is a RELAY ONLY. It must never import Electron,
 * never open the SQLite database, never read the user secret key, and never
 * choose cookie domains. It only:
 *   1. reads Chromium-framed messages from stdin (32-bit LE length + UTF-8 JSON);
 *   2. enforces the payload cap and validates the wire schema;
 *   3. forwards the validated message to the desktop main process;
 *   4. frames a reply back to stdout.
 *
 * The desktop main process re-validates everything because this host is a
 * transport boundary, not a trust boundary.
 *
 * The actual local authenticated transport (named pipe / Unix-domain socket) is
 * an installer/OS concern (design Open Implementation Decision #1) and is not
 * wired here; `relayToDesktop` is the injection point.
 */

/** Read a 32-bit little-endian length prefix. Returns null if < 4 bytes. */
export function parseLengthPrefix(buf: Buffer): number | null {
  if (buf.length < 4) {
    return null;
  }
  return buf.readUInt32LE(0);
}

export class NativeHostProtocolError extends Error {
  constructor(
    public readonly code: "OVERSIZE" | "INVALID_JSON" | "INVALID_SHAPE",
    message?: string
  ) {
    super(message ?? code);
    this.name = "NativeHostProtocolError";
  }
}

/**
 * Decode + validate a native-messaging JSON payload. Enforces the size cap
 * BEFORE parsing (design §9.6) and validates the schema after parsing.
 */
export function decodeNativeMessage(payload: Buffer): NativeMessage {
  if (payload.length > NATIVE_MESSAGE_MAX_BYTES) {
    throw new NativeHostProtocolError("OVERSIZE");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new NativeHostProtocolError("INVALID_JSON");
  }
  const result = nativeMessageSchema.safeParse(parsed);
  if (!result.success) {
    throw new NativeHostProtocolError("INVALID_SHAPE");
  }
  return result.data;
}

/** Frame a reply for Chromium native messaging (32-bit LE length + JSON). */
export function encodeNativeMessage(message: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

/**
 * Injection point for the local authenticated transport to the desktop main
 * process. The default implementation is a no-op; the installer/OS integration
 * (design §9.5) replaces it with a named-pipe / Unix-socket relay. It must not
 * be reached in production until the host manifest is registered.
 */
export type RelayToDesktop = (message: NativeMessage) => Promise<void>;

/**
 * Run the native host loop. Reads stdin in framed chunks, validates, relays.
 * Never throws to the caller; protocol errors are logged with SAFE codes only
 * (no cookie values, no requestSecret) and the host continues.
 */
export async function runNativeHost(
  input: NodeJS.ReadableStream,
  relay: RelayToDesktop = async () => {
    /* no-op until installer registers the host */
  }
): Promise<void> {
  let buffer = Buffer.alloc(0);

  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);
    // Parse as many complete framed messages as are available.
    while (buffer.length >= 4) {
      const length = parseLengthPrefix(buffer);
      if (length === null) {
        break;
      }
      const total = 4 + length;
      if (buffer.length < total) {
        break; // wait for more bytes
      }
      const payload = buffer.subarray(4, total);
      buffer = buffer.subarray(total);
      try {
        const message = decodeNativeMessage(payload);
        await relay(message);
      } catch (err) {
        if (err instanceof NativeHostProtocolError) {
          log.warn(`[native-host] rejected message (${err.code})`);
        } else {
          log.warn("[native-host] relay error");
        }
      }
    }
  }
}
