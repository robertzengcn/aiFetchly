/**
 * STUB — RED phase of TDD for the global config loader (CFG-01/03/04/06).
 *
 * The real implementation lands in the GREEN commit. This stub returns an
 * empty snapshot so the assertions expecting files/instructions/diagnostics
 * fail. It does, however, wire the real default root (os.homedir + dir name)
 * so tsc resolves all imports.
 */

import * as os from "os";
import * as path from "path";
import type {
  AIFetchlyConfigSettings,
  AIFetchlyConfigSnapshot,
} from "@/entityTypes/aifetchlyConfigTypes";
import {
  AIFETCHLY_CONFIG_DIR_NAME,
  DEFAULT_AIFETCHLY_CONFIG_SETTINGS,
} from "./AIFetchlyConfigConstants";

export class AIFetchlyConfigLoader {
  private readonly rootPath: string;
  private settings: AIFetchlyConfigSettings = DEFAULT_AIFETCHLY_CONFIG_SETTINGS;

  constructor(rootPath?: string) {
    this.rootPath =
      rootPath ?? path.join(os.homedir(), AIFETCHLY_CONFIG_DIR_NAME);
  }

  getSettings(): AIFetchlyConfigSettings {
    return this.settings;
  }

  async scanGlobalRoot(): Promise<AIFetchlyConfigSnapshot> {
    return {
      source: "user",
      sourceId: "user",
      rootPath: this.rootPath,
      version: 1,
      files: [],
      instructions: [],
      commands: [],
      agents: [],
      hooks: [],
      skills: [],
      diagnostics: [],
    };
  }
}
