import { expect } from "chai";
import {
  ToolTimeoutClass,
  TOOL_TIMEOUT_POLICY,
  resolveTimeoutMs,
  inferTimeoutClassByName,
} from "@/service/ToolTimeoutPolicy";

describe("ToolTimeoutPolicy", () => {
  describe("TOOL_TIMEOUT_POLICY", () => {
    it("exposes fast/network/browser ceilings and omits async", () => {
      expect(TOOL_TIMEOUT_POLICY.fast).to.equal(30_000);
      expect(TOOL_TIMEOUT_POLICY.network).to.equal(90_000);
      expect(TOOL_TIMEOUT_POLICY.browser).to.equal(240_000);
    });
  });

  describe("resolveTimeoutMs", () => {
    it("returns the class ceiling for fast/network/browser", () => {
      expect(resolveTimeoutMs("fast")).to.equal(30_000);
      expect(resolveTimeoutMs("network")).to.equal(90_000);
      expect(resolveTimeoutMs("browser")).to.equal(240_000);
    });
    it("returns null for async (no synchronous ceiling)", () => {
      expect(resolveTimeoutMs("async")).to.equal(null);
    });
  });

  describe("inferTimeoutClassByName", () => {
    it("classifies file tools as fast", () => {
      expect(inferTimeoutClassByName("file_read")).to.equal("fast");
      expect(inferTimeoutClassByName("glob_files")).to.equal("fast");
      expect(inferTimeoutClassByName("grep_files")).to.equal("fast");
      expect(inferTimeoutClassByName("read_url_content")).to.equal("fast");
    });
    it("classifies browser-automation tools as browser", () => {
      expect(inferTimeoutClassByName("search_maps_businesses")).to.equal("browser");
      expect(inferTimeoutClassByName("extract_contact_info")).to.equal("browser");
    });
    it("classifies network tools as network", () => {
      expect(inferTimeoutClassByName("analyze_website")).to.equal("network");
      expect(inferTimeoutClassByName("search_yellow_pages")).to.equal("network");
    });
    it("defaults unknown tools to fast", () => {
      expect(inferTimeoutClassByName("something_new")).to.equal("fast");
    });
  });
});
