import { describe, expect, it } from "vitest";
import {
  isLocalAiRuntimeInstallRequired,
  isLocalAiRuntimeUsable,
} from "@/views/utils/localAiRuntimeUi";

describe("localAiRuntimeUi", () => {
  describe("isLocalAiRuntimeUsable", () => {
    it("returns true for ready and update_available", () => {
      expect(isLocalAiRuntimeUsable("ready")).toBe(true);
      expect(isLocalAiRuntimeUsable("update_available")).toBe(true);
    });

    it("returns false when the runtime component is absent or broken", () => {
      expect(isLocalAiRuntimeUsable(undefined)).toBe(false);
      expect(isLocalAiRuntimeUsable("not_installed")).toBe(false);
      expect(isLocalAiRuntimeUsable("download_required")).toBe(false);
      expect(isLocalAiRuntimeUsable("incompatible")).toBe(false);
      expect(isLocalAiRuntimeUsable("corrupted")).toBe(false);
    });
  });

  describe("isLocalAiRuntimeInstallRequired", () => {
    it("matches the settings panel install affordance states", () => {
      expect(isLocalAiRuntimeInstallRequired("not_installed")).toBe(true);
      expect(isLocalAiRuntimeInstallRequired("download_required")).toBe(true);
      expect(isLocalAiRuntimeInstallRequired("incompatible")).toBe(true);
    });

    it("returns false when installed or mid-operation", () => {
      expect(isLocalAiRuntimeInstallRequired("ready")).toBe(false);
      expect(isLocalAiRuntimeInstallRequired("update_available")).toBe(false);
      expect(isLocalAiRuntimeInstallRequired("downloading")).toBe(false);
    });
  });
});
