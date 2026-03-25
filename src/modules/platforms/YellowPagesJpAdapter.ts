import { JapaneseYellowPagesAdapter } from "@/modules/platforms/JapaneseYellowPagesAdapter";
import { PlatformConfig } from "@/modules/interface/IPlatformConfig";

/**
 * Adapter for YellowPages-JP platform.
 * Extends JapaneseYellowPagesAdapter for common Japanese platform functionality.
 *
 * Platform: https://www.yellowpages-jp.com
 */
export class YellowPagesJpAdapter extends JapaneseYellowPagesAdapter {
  constructor(config: PlatformConfig) {
    super(config);
  }
}
