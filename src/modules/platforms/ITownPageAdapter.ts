import { JapaneseYellowPagesAdapter } from "@/modules/platforms/JapaneseYellowPagesAdapter";
import { PlatformConfig } from "@/modules/interface/IPlatformConfig";

/**
 * Adapter for iTownPage (Japan) yellow pages platform.
 * Extends JapaneseYellowPagesAdapter for common Japanese platform functionality.
 *
 * Platform: https://itp.ne.jp
 */
export class ITownPageAdapter extends JapaneseYellowPagesAdapter {
  constructor(config: PlatformConfig) {
    super(config);
  }
}
