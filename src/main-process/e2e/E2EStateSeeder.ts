/**
 * Deterministic AI/auth/database state seeder for the Electron E2E bootstrap
 * (design §8.3).
 *
 * Runs in the Electron main process AFTER userData/DB paths are established and
 * the network guard is installed, and BEFORE importing background.ts. It reads
 * the validated state manifest and configures the encrypted Token store so the
 * app starts in a deterministic AI-enabled or AI-disabled state without any
 * production tokens or remote login.
 *
 *   local-enabled   -> mode=local, loopback provider saved via the production
 *                      AIProviderSettingsService (so resolveForChat() returns
 *                      kind=local and requests hit the FakeOpenAI server),
 *                      USER_AI_ENABLED=true, USERSDBPATH=<root>/database.
 *   hosted-disabled -> mode=hosted, USER_AI_ENABLED=false so the entitlement
 *                      gate rejects before any transport call (the fake server
 *                      request log must stay empty).
 *
 * Uses production services (never opens repositories or runs SQL directly) and
 * writes only inside the per-test root via the redirected Token store.
 */

import * as fs from "fs";
import type { E2EEnvironment } from "./E2EEnvironment";
import { parseStateManifest } from "./E2EEnvironment";
import { AIProviderSettingsService } from "@/service/aiProvider/AIProviderSettingsService";
import { Token } from "@/modules/token";
import { USERSDBPATH, USER_AI_ENABLED } from "@/config/usersetting";

/** Must match FAKE_MODEL_ID in test/e2e/scenarios/openAiProtocol.ts. */
const E2E_MODEL_ID = "aifetchly-e2e-model";

/**
 * Seed the Token store from the state manifest. No-op when no state file is
 * configured (plain launch/security tests). Throws if the manifest is invalid
 * (parseStateManifest validates it).
 */
export function seedE2EState(environment: E2EEnvironment): void {
  // The bootstrap always receives a state-file path, but the file only exists
  // for AI scenarios; plain launch/security tests write none. No file => no seed.
  if (!environment.stateFilePath || !fs.existsSync(environment.stateFilePath)) {
    return;
  }
  const manifest = parseStateManifest(environment.stateFilePath);
  const token = new Token();

  // The database path always resolves through Token/USERSDBPATH; pin it to the
  // isolated root so Models/Modules never touch a real database (design §8.2).
  token.setValue(USERSDBPATH, environment.databasePath);

  if (manifest.aiState === "local-enabled") {
    const settings = new AIProviderSettingsService(token);
    // Save through the production service so the stored shape exactly matches
    // what AIProviderResolver reads. clearApiKey keeps the secret store empty
    // (the fake server needs no auth) and avoids touching OS keychain crypto.
    settings.saveLocalProvider({
      preset: "custom",
      name: "AiFetchly E2E Provider",
      baseUrl: manifest.fakeAiBaseUrl,
      defaultModel: E2E_MODEL_ID,
      clearApiKey: true,
      capabilities: {
        modelsEndpoint: "supported",
        chat: "supported",
        streaming: "supported",
        tools: "supported",
        vision: "unsupported",
      },
    });
    settings.setMode("local");
    token.setValue(USER_AI_ENABLED, "true");
    return;
  }

  // hosted-disabled: gate rejects before transport; fake server stays untouched.
  const settings = new AIProviderSettingsService(token);
  settings.setMode("hosted");
  token.setValue(USER_AI_ENABLED, "false");
}
