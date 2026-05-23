import { JapaneseYellowPagesAdapter } from "@/modules/platforms/JapaneseYellowPagesAdapter";
import { PlatformConfig } from "@/modules/interface/IPlatformConfig";

/**
 * Adapter for uSonar Yellow Page (Japan) platform.
 * Extends JapaneseYellowPagesAdapter for common Japanese platform functionality.
 *
 * Platform: https://yellowpage.usonar.co.jp
 */
export class USonarYellowPageAdapter extends JapaneseYellowPagesAdapter {
  constructor(config: PlatformConfig) {
    super(config);
  }
}
