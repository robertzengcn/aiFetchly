import { describe, it, expect } from "vitest";
import { extractToolResultImages } from "@/service/toolResultImageHarvest";
import type { OpenAIChatImage } from "@/api/aiChatApi";

const img = (path: string): OpenAIChatImage => ({
  type: "image",
  delivery: "local_file",
  local_path: path,
  url: `aifetchly-generated-image://local/u/c/m/${path}`,
  mime_type: "image/png",
});

describe("extractToolResultImages", () => {
  it("returns images from a well-formed outputImages array", () => {
    const out = extractToolResultImages({
      result: { outputImages: [img("/b1.png"), img("/b2.png")] },
    });
    expect(out.map((i) => i.local_path)).toEqual(["/b1.png", "/b2.png"]);
  });

  it("returns empty for missing or non-array outputImages", () => {
    expect(extractToolResultImages({ result: {} })).toEqual([]);
    expect(extractToolResultImages({ result: { outputImages: "no" } })).toEqual(
      []
    );
    expect(extractToolResultImages({ result: { outputImages: null } })).toEqual(
      []
    );
    expect(extractToolResultImages({})).toEqual([]);
  });

  it("skips non-object entries (null/string/number)", () => {
    const out = extractToolResultImages({
      result: { outputImages: [img("/b1.png"), null, "x", 5] },
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.local_path).toBe("/b1.png");
  });

  it("finds images nested under result.result.outputImages (async-tool envelope)", () => {
    // run_subagent is async; pollAsyncJobToCompletion wraps its bare
    // SkillExecutionResult under a second `result` envelope, so production
    // toolResults carry outputImages at result.result.outputImages — NOT
    // result.outputImages. This test locks that shape in.
    const out = extractToolResultImages({
      result: {
        success: true,
        result: {
          agentTaskId: "agt-1",
          outputImages: [img("/b1.png"), img("/b2.png")],
        },
      },
    });
    expect(out.map((i) => i.local_path)).toEqual(["/b1.png", "/b2.png"]);
  });

  it("rejects garbage objects that lack url/b64_json/local_path", () => {
    const out = extractToolResultImages({
      result: {
        outputImages: [
          img("/b1.png"),
          { type: "image" }, // no locator string -> rejected
          { foo: "bar", baz: 42 },
          [1, 2, 3], // array passes typeof object but has no locators
        ],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.local_path).toBe("/b1.png");
  });
});
