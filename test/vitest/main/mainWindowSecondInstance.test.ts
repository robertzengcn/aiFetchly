import { describe, expect, it } from "vitest";
import { resolveSecondInstanceWindowAction } from "@/utils/mainWindowSecondInstance";

describe("resolveSecondInstanceWindowAction", () => {
  it("focuses a healthy live window", () => {
    expect(
      resolveSecondInstanceWindowAction({
        hasLiveWindow: true,
        rendererHtmlLoaded: true,
      })
    ).toBe("focus");
  });

  it("recreates when the first instance has no window", () => {
    expect(
      resolveSecondInstanceWindowAction({
        hasLiveWindow: false,
        rendererHtmlLoaded: false,
      })
    ).toBe("recreate");
  });

  it("recreates when a live window never finished loading the renderer", () => {
    expect(
      resolveSecondInstanceWindowAction({
        hasLiveWindow: true,
        rendererHtmlLoaded: false,
      })
    ).toBe("recreate");
  });
});
