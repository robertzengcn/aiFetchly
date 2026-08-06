import { describe, it, expect } from "vitest";
import {
  parseLengthPrefix,
  decodeNativeMessage,
  encodeNativeMessage,
  NativeHostProtocolError,
} from "@/childprocess/browserProfileNativeHost";

describe("native-host framing helpers", () => {
  it("parseLengthPrefix reads a 32-bit LE length, returns null < 4 bytes", () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(42, 0);
    expect(parseLengthPrefix(buf)).toBe(42);
    expect(parseLengthPrefix(Buffer.from([1, 2, 3]))).toBeNull();
  });

  it("encodeNativeMessage frames a 4-byte LE length + JSON payload", () => {
    const framed = encodeNativeMessage({ hello: "world" });
    expect(framed.readUInt32LE(0)).toBe(framed.length - 4);
    expect(JSON.parse(framed.subarray(4).toString("utf8")).hello).toBe("world");
  });

  it("decodeNativeMessage validates a well-formed import_result", () => {
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        type: "import_result",
        requestId: "r",
        requestSecret: "abcdefghijklmnop",
        cookies: [],
        extensionVersion: "1.0.0",
      }),
      "utf8"
    );
    const msg = decodeNativeMessage(payload);
    expect(msg.type).toBe("import_result");
  });

  it("decodeNativeMessage rejects oversize payloads before parsing", () => {
    const oversize = Buffer.alloc(1024 * 1024 + 100, 65); // > 1 MiB
    expect(() => decodeNativeMessage(oversize)).toThrow(NativeHostProtocolError);
  });

  it("decodeNativeMessage rejects invalid JSON", () => {
    expect(() => decodeNativeMessage(Buffer.from("not json{{"))).toThrow(
      NativeHostProtocolError
    );
  });

  it("decodeNativeMessage rejects a wrong-shaped message", () => {
    expect(() =>
      decodeNativeMessage(Buffer.from(JSON.stringify({ type: "bogus" })))
    ).toThrow(NativeHostProtocolError);
  });

  it("encode -> decode round-trips a valid message", () => {
    const framed = encodeNativeMessage({
      version: 1,
      type: "import_result",
      requestId: "r",
      requestSecret: "abcdefghijklmnop",
      cookies: [],
      extensionVersion: "1.0.0",
    });
    const payload = framed.subarray(4);
    const msg = decodeNativeMessage(payload);
    expect(msg.type).toBe("import_result");
  });
});
