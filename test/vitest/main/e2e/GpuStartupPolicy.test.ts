import { describe, it, expect } from "vitest";
import {
  resolveGpuStartupPolicy,
} from "@/main-process/startup/GpuStartupPolicy";

describe("GpuStartupPolicy", () => {
  it("disables GPU in dev on every platform", () => {
    expect(
      resolveGpuStartupPolicy({}, "darwin", true)
    ).toEqual({ disableGpu: true, reason: "dev" });
    expect(
      resolveGpuStartupPolicy({}, "win32", true)
    ).toEqual({ disableGpu: true, reason: "dev" });
    expect(
      resolveGpuStartupPolicy({}, "linux", true)
    ).toEqual({ disableGpu: true, reason: "dev" });
  });

  it("keeps GPU acceleration in packaged builds outside Linux", () => {
    expect(
      resolveGpuStartupPolicy(
        { WSL_DISTRO_NAME: "Ubuntu-22.04" },
        "darwin",
        false
      )
    ).toEqual({ disableGpu: false, reason: "none" });
    expect(
      resolveGpuStartupPolicy({ WSL_INTEROP: "/run/WSL/8" }, "win32", false)
    ).toEqual({ disableGpu: false, reason: "none" });
  });

  it("disables GPU on WSL Linux in dev and packaged builds", () => {
    expect(
      resolveGpuStartupPolicy(
        { WSL_DISTRO_NAME: "Ubuntu-22.04" },
        "linux",
        true
      ).disableGpu
    ).toBe(true);
    expect(
      resolveGpuStartupPolicy(
        { WSL_DISTRO_NAME: "Ubuntu-22.04" },
        "linux",
        true
      ).reason
    ).toBe("wsl");
    expect(
      resolveGpuStartupPolicy(
        { WSL_INTEROP: "/run/WSL/8" },
        "linux",
        false
      ).disableGpu
    ).toBe(true);
  });

  it("honours the explicit AIFETCHLY_DISABLE_GPU=1 opt-in on any platform", () => {
    expect(
      resolveGpuStartupPolicy(
        { AIFETCHLY_DISABLE_GPU: "1", WSL_DISTRO_NAME: "X" },
        "linux",
        true
      ).reason
    ).toBe("explicit-flag");
    expect(
      resolveGpuStartupPolicy(
        { AIFETCHLY_DISABLE_GPU: "1" },
        "linux",
        false
      ).disableGpu
    ).toBe(true);
    expect(
      resolveGpuStartupPolicy(
        { AIFETCHLY_DISABLE_GPU: "1" },
        "darwin",
        true
      ).disableGpu
    ).toBe(true);
  });

  it("requires the exact sentinel '1' for the explicit opt-in", () => {
    expect(
      resolveGpuStartupPolicy(
        { AIFETCHLY_DISABLE_GPU: "true" },
        "linux",
        true
      ).disableGpu
    ).toBe(true); // dev alone already disables; the flag value is irrelevant here
    expect(
      resolveGpuStartupPolicy(
        { AIFETCHLY_DISABLE_GPU: "true" },
        "linux",
        false
      ).disableGpu
    ).toBe(false);
  });

  it("preserves the legacy dev-only indirect GL trigger", () => {
    expect(
      resolveGpuStartupPolicy(
        { LIBGL_ALWAYS_INDIRECT: "1" },
        "linux",
        true
      ).reason
    ).toBe("indirect-gl");
    expect(
      resolveGpuStartupPolicy(
        { LIBGL_ALWAYS_INDIRECT: "1" },
        "linux",
        false
      ).disableGpu
    ).toBe(false);
  });

  it("does not disable GPU when no trigger applies (packaged)", () => {
    expect(resolveGpuStartupPolicy({}, "linux", false)).toEqual({
      disableGpu: false,
      reason: "none",
    });
  });
});
