import { describe, expect, test } from "vitest";
import { BasePlatformAdapter } from "@/modules/BasePlatformAdapter";
import { PlatformConfig } from "@/modules/interface/IPlatformConfig";
import { PlatformAdapterFactory } from "@/modules/platforms/PlatformAdapterFactory";
import { USonarYellowPageAdapter } from "@/modules/platforms/USonarYellowPageAdapter";
import { Platform_usonar_yellowpage_jp } from "@/config/platforms/usonar-yellowpage-jp";

describe("worker PlatformAdapterFactory", () => {
  test("resolves stable class names when constructor names are minified", () => {
    const MinifiedUSonarAdapter = class uSn {};
    const minifiedPlatformConfig = {
      id: "usonar-yellowpage-jp",
      adapter_class: MinifiedUSonarAdapter as unknown as new (
        config: PlatformConfig
      ) => BasePlatformAdapter,
    };

    expect(MinifiedUSonarAdapter.name).toBe("uSn");
    expect(
      PlatformAdapterFactory.getAdapterClassNameForPlatform(
        minifiedPlatformConfig
      )
    ).toBe("USonarYellowPageAdapter");
  });

  test("creates uSonar adapter from stable class name", () => {
    const adapter = PlatformAdapterFactory.createAdapter(
      "USonarYellowPageAdapter",
      Platform_usonar_yellowpage_jp
    );

    expect(adapter).toBeInstanceOf(USonarYellowPageAdapter);
  });
});
