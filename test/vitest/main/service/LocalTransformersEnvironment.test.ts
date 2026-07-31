"use strict";
import { describe, expect, it } from "vitest";
import { resolveLocalTransformersConfig } from "@/childprocess/embedding/LocalTransformersEnvironment";

describe("resolveLocalTransformersConfig", () => {
  it("uses a stable app cache directory by default", () => {
    const config = resolveLocalTransformersConfig({}, "/home/tester");

    expect(config.cacheDir).toBe("/home/tester/.cache/aifetchly/transformers");
    expect(config.allowRemoteModels).toBe(true);
    expect(config.remoteHosts).toEqual([
      "https://huggingface.co/",
      "https://hf-mirror.com/",
    ]);
  });

  it("honors explicit cache, local path, and remote hosts", () => {
    const config = resolveLocalTransformersConfig(
      {
        AIFETCHLY_TRANSFORMERS_CACHE: "/tmp/t-cache",
        AIFETCHLY_TRANSFORMERS_LOCAL_MODEL_PATH: "/models",
        AIFETCHLY_TRANSFORMERS_REMOTE_HOSTS:
          "https://mirror-a.example, https://mirror-b.example/",
      },
      "/home/tester"
    );

    expect(config.cacheDir).toBe("/tmp/t-cache");
    expect(config.localModelPath).toBe("/models");
    expect(config.remoteHosts).toEqual([
      "https://mirror-a.example/",
      "https://mirror-b.example/",
    ]);
  });

  it("uses HF_ENDPOINT as a supported remote host override", () => {
    const config = resolveLocalTransformersConfig(
      { HF_ENDPOINT: "https://hf.example" },
      "/home/tester"
    );

    expect(config.remoteHosts).toEqual(["https://hf.example/"]);
  });

  it("disables remote downloads when offline env is set", () => {
    const config = resolveLocalTransformersConfig(
      { TRANSFORMERS_OFFLINE: "true" },
      "/home/tester"
    );

    expect(config.allowRemoteModels).toBe(false);
  });
});
