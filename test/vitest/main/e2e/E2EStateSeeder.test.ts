import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import sinon from "sinon";
import { seedE2EState } from "@/main-process/e2e/E2EStateSeeder";
import { Token } from "@/modules/token";
import { AIProviderSettingsService } from "@/service/aiProvider/AIProviderSettingsService";
import type { E2EEnvironment } from "@/main-process/e2e/E2EEnvironment";

function makeEnv(root: string, stateFile: string): E2EEnvironment {
  return {
    rootPath: root,
    userDataPath: path.join(root, "user-data"),
    databasePath: path.join(root, "database"),
    workspacePath: path.join(root, "workspace"),
    downloadsPath: path.join(root, "downloads"),
    logsPath: path.join(root, "logs"),
    fakeAiBaseUrl: "http://127.0.0.1:6000/v1",
    allowedOrigins: ["http://127.0.0.1:5173"],
    stateFilePath: stateFile,
  };
}

function writeManifest(
  file: string,
  aiState: "local-enabled" | "hosted-disabled"
): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 1,
      authState: "authenticated",
      aiState,
      locale: "en",
      fakeAiBaseUrl: "http://127.0.0.1:6000/v1",
      workspacePath: "/tmp/aifetchly-e2e/ws",
    }),
    "utf8"
  );
}

describe("E2EStateSeeder", () => {
  let root: string;
  let tokenSetStub: sinon.SinonStub;
  let saveProviderStub: sinon.SinonStub;
  let setModeStub: sinon.SinonStub;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-e2e-seed-"));
    // Capture Token writes without touching the encrypted store / safeStorage.
    tokenSetStub = sinon.stub(Token.prototype, "setValue").returns(undefined);
    saveProviderStub = sinon
      .stub(AIProviderSettingsService.prototype, "saveLocalProvider")
      .returns({} as never);
    setModeStub = sinon
      .stub(AIProviderSettingsService.prototype, "setMode")
      .returns(undefined);
  });
  afterEach(() => {
    sinon.restore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("is a no-op when no state file is present (plain launch)", () => {
    const env = makeEnv(root, path.join(root, "absent.json"));
    expect(() => seedE2EState(env)).not.toThrow();
    expect(tokenSetStub.called).toBe(false);
  });

  it("hosted-disabled sets USER_AI_ENABLED=false + mode hosted", () => {
    const file = path.join(root, "state.json");
    writeManifest(file, "hosted-disabled");
    seedE2EState(makeEnv(root, file));

    const keys = tokenSetStub.getCalls().map((c) => c.args[0]);
    expect(keys).toContain("user_dbpath"); // USERSDBPATH
    expect(keys).toContain("user_ai_enabled"); // USER_AI_ENABLED
    const aiCall = tokenSetStub.getCalls().find(
      (c) => c.args[0] === "user_ai_enabled"
    );
    expect(aiCall?.args[1]).toBe("false");
    expect(setModeStub.calledWith("hosted")).toBe(true);
    expect(saveProviderStub.called).toBe(false);
  });

  it("local-enabled seeds the loopback provider + USER_AI_ENABLED=true", () => {
    const file = path.join(root, "state.json");
    writeManifest(file, "local-enabled");
    const env = makeEnv(root, file);
    seedE2EState(env);

    expect(saveProviderStub.calledOnce).toBe(true);
    const input = saveProviderStub.firstCall.args[0] as {
      baseUrl?: string;
      defaultModel?: string;
      clearApiKey?: boolean;
    };
    // The provider must point at the loopback fake server (no production token).
    expect(input.baseUrl).toBe("http://127.0.0.1:6000/v1");
    expect(input.clearApiKey).toBe(true);
    expect(setModeStub.calledWith("local")).toBe(true);
    const aiCall = tokenSetStub.getCalls().find(
      (c) => c.args[0] === "user_ai_enabled"
    );
    expect(aiCall?.args[1]).toBe("true");
    // USERSDBPATH is pinned to the isolated root.
    const dbCall = tokenSetStub.getCalls().find(
      (c) => c.args[0] === "user_dbpath"
    );
    expect(dbCall?.args[1]).toBe(env.databasePath);
  });

  it("authenticated state seeds local user email/name (no remote login)", () => {
    const file = path.join(root, "state.json");
    writeManifest(file, "local-enabled");
    seedE2EState(makeEnv(root, file));
    const keys = tokenSetStub.getCalls().map((c) => c.args[0]);
    expect(keys).toContain("user_email");
    expect(keys).toContain("user_name");
  });
});
