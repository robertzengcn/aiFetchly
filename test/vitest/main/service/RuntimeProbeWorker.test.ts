import { describe, expect, test, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  dispatchProbeMessage,
  type ProbeSink,
} from "@/childprocess/local-ai-runtime/RuntimeProbeWorker";
import type { RuntimeProbeResult } from "@/schemas/worker/runtimeProbe";
import {
  runtimeProbeRequestSchema,
  runtimeProbeResultSchema,
} from "@/schemas/worker/runtimeProbe";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "probe-worker-"));
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** Build a fake runtime root whose entryModule exports the given names. */
function writeFakeRuntime(
  exportNames: readonly string[],
  entryFile = "fake-native.js"
): { runtimeRoot: string; entryModule: string } {
  const exports = exportNames
    .map((n) => `${n}: function ${n}() {}`)
    .join(", ");
  fs.writeFileSync(
    path.join(tmpRoot, "package.json"),
    JSON.stringify({ name: "fake-runtime", version: "1.0.0" })
  );
  fs.writeFileSync(
    path.join(tmpRoot, entryFile),
    `module.exports = { ${exports} };`
  );
  return { runtimeRoot: tmpRoot, entryModule: `./${entryFile}` };
}

function recorderSink(): ProbeSink & { last: RuntimeProbeResult | null } {
  let last: RuntimeProbeResult | null = null;
  const sink: ProbeSink & { last: RuntimeProbeResult | null } = {
    post(message) {
      last = message;
    },
    exit() {
      /* no-op for tests */
    },
    get last() {
      return last;
    },
  };
  return sink;
}

describe("RuntimeProbeWorker dispatch", () => {
  test("reports ok when all required exports are functions", async () => {
    const { runtimeRoot, entryModule } = writeFakeRuntime([
      "OfflineRecognizer",
      "OfflineTts",
      "GenerationConfig",
    ]);
    const sink = recorderSink();
    await dispatchProbeMessage(
      {
        type: "probe",
        requestId: "req-1",
        runtimeRoot,
        entryModule,
        requiredExports: ["OfflineRecognizer", "OfflineTts", "GenerationConfig"],
      },
      sink
    );
    expect(sink.last).not.toBeNull();
    expect(sink.last?.type).toBe("result");
    expect(sink.last?.requestId).toBe("req-1");
    expect(sink.last?.ok).toBe(true);
    expect(sink.last?.exports).toEqual([
      { name: "OfflineRecognizer", present: true },
      { name: "OfflineTts", present: true },
      { name: "GenerationConfig", present: true },
    ]);
  });

  test("reports ok:false with the missing names when exports are absent", async () => {
    const { runtimeRoot, entryModule } = writeFakeRuntime(["OfflineRecognizer"]);
    const sink = recorderSink();
    await dispatchProbeMessage(
      {
        type: "probe",
        requestId: "req-2",
        runtimeRoot,
        entryModule,
        requiredExports: ["OfflineRecognizer", "OfflineTts"],
      },
      sink
    );
    expect(sink.last?.ok).toBe(false);
    expect(sink.last?.errorMessage).toContain("OfflineTts");
    expect(sink.last?.exports).toContainEqual({
      name: "OfflineTts",
      present: false,
    });
  });

  test("reports ok:false when the native module fails to load", async () => {
    fs.writeFileSync(
      path.join(tmpRoot, "package.json"),
      JSON.stringify({ name: "fake-runtime" })
    );
    const sink = recorderSink();
    await dispatchProbeMessage(
      {
        type: "probe",
        requestId: "req-3",
        runtimeRoot: tmpRoot,
        entryModule: "./does-not-exist.js",
        requiredExports: [],
      },
      sink
    );
    expect(sink.last?.ok).toBe(false);
    expect(sink.last?.errorMessage).toContain("Native load failed");
  });

  test("rejects an invalid inbound payload without loading anything", async () => {
    const sink = recorderSink();
    await dispatchProbeMessage({ type: "not-probe" }, sink);
    expect(sink.last?.ok).toBe(false);
    expect(sink.last?.errorMessage).toContain("Invalid probe request");
    expect(sink.last?.requestId).toBe("unknown");
  });
});

describe("RuntimeProbeWorker schema validation", () => {
  test("request schema accepts a well-formed probe and defaults requiredExports", () => {
    const parsed = runtimeProbeRequestSchema.safeParse({
      type: "probe",
      requestId: "r",
      runtimeRoot: "/tmp/root",
      entryModule: "sherpa-onnx-node",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.requiredExports).toEqual([]);
    }
  });

  test("result schema round-trips the worker output", () => {
    const payload = {
      type: "result",
      requestId: "r",
      ok: true,
      exports: [{ name: "OfflineTts", present: true }],
    };
    const parsed = runtimeProbeResultSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  test("result schema rejects a non-boolean present flag", () => {
    const parsed = runtimeProbeResultSchema.safeParse({
      type: "result",
      requestId: "r",
      ok: true,
      exports: [{ name: "OfflineTts", present: "yes" }],
    });
    expect(parsed.success).toBe(false);
  });
});
