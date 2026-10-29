import { describe, it, expect } from "vitest";
import { withLinuxChromiumStabilityFlags } from "@/modules/lib/chromiumLaunchFlags";

describe("withLinuxChromiumStabilityFlags", () => {
  it("appends --no-sandbox and --disable-gpu on Linux when missing", () => {
    expect(
      withLinuxChromiumStabilityFlags(
        ["--user-agent=test-ua"],
        "linux"
      )
    ).toEqual(["--user-agent=test-ua", "--no-sandbox", "--disable-gpu"]);
  });

  it("does not duplicate flags the caller already provided", () => {
    expect(
      withLinuxChromiumStabilityFlags(
        ["--no-sandbox", "--disable-gpu", "--custom"],
        "linux"
      )
    ).toEqual(["--no-sandbox", "--disable-gpu", "--custom"]);
  });

  it("returns the original args unchanged on Windows and macOS", () => {
    expect(withLinuxChromiumStabilityFlags(["-a"], "win32")).toEqual(["-a"]);
    expect(withLinuxChromiumStabilityFlags(["-a"], "darwin")).toEqual(["-a"]);
  });

  it("returns a new array rather than mutating or reusing the input", () => {
    const original = ["-a"];
    const merged = withLinuxChromiumStabilityFlags(original, "linux");
    expect(merged).not.toBe(original);
    expect(original).toEqual(["-a"]);
    expect(merged.length).toBe(3);
  });
});
