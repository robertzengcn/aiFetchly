import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  loadE2EEnvironment,
  parseStateManifest,
  E2EEnvironmentError,
} from "@/main-process/e2e/E2EEnvironment";

const ROOT_SEGMENT = "aifetchly-e2e";

function validRoot(): string {
  // A unique run root under /tmp/aifetchly-e2e/<run>/... that is neither home
  // nor cwd nor a filesystem root.
  return path.join(
    os.tmpdir(),
    ROOT_SEGMENT,
    `unit-${process.pid}`,
    `run-${Math.floor(Math.random() * 1e9)}`
  );
}

describe("E2EEnvironment", () => {
  let roots: string[] = [];
  const cleanup = (): void => {
    for (const r of roots) {
      try {
        fs.rmSync(r, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    roots = [];
  };
  beforeEach(cleanup);
  afterEach(cleanup);

  const baseEnv = (root: string): NodeJS.ProcessEnv => ({
    AIFETCHLY_E2E: "1",
    AIFETCHLY_E2E_ROOT: root,
    AIFETCHLY_E2E_STATE_FILE: path.join(root, "state.json"),
    AIFETCHLY_E2E_AI_BASE_URL: "http://127.0.0.1:5174/v1",
    AIFETCHLY_E2E_ALLOWED_ORIGINS:
      "http://127.0.0.1:5173,http://127.0.0.1:5174",
    ELECTRON_USER_DATA_PATH: path.join(root, "user-data"),
    IS_TEST: "1",
    NODE_ENV: "test",
  });

  it("loads a valid environment and derives contained child paths", () => {
    const root = validRoot();
    roots.push(root);
    const env = loadE2EEnvironment(baseEnv(root));
    expect(env.rootPath).toBe(path.resolve(root));
    expect(env.userDataPath).toBe(path.join(root, "user-data"));
    expect(env.databasePath).toBe(path.join(root, "database"));
    expect(env.workspacePath).toBe(path.join(root, "workspace"));
    expect(env.downloadsPath).toBe(path.join(root, "downloads"));
    expect(env.logsPath).toBe(path.join(root, "logs"));
    expect(env.fakeAiBaseUrl).toBe("http://127.0.0.1:5174/v1");
    expect(env.allowedOrigins).toEqual([
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
    ]);
  });

  it("rejects when AIFETCHLY_E2E is not exactly '1'", () => {
    const root = validRoot();
    expect(() =>
      loadE2EEnvironment({ ...baseEnv(root), AIFETCHLY_E2E: "true" })
    ).toThrow(E2EEnvironmentError);
    expect(() =>
      loadE2EEnvironment({ ...baseEnv(root), AIFETCHLY_E2E: undefined })
    ).toThrow(E2EEnvironmentError);
  });

  it("rejects a root that is not under the aifetchly-e2e run tree", () => {
    const badRoot = path.join(os.tmpdir(), "not-an-e2e-root", "child");
    expect(() => loadE2EEnvironment(baseEnv(badRoot))).toThrow(
      E2EEnvironmentError
    );
  });

  it("rejects the home directory and the project working directory as root", () => {
    expect(() => loadE2EEnvironment(baseEnv(os.homedir()))).toThrow(
      E2EEnvironmentError
    );
    expect(() => loadE2EEnvironment(baseEnv(process.cwd()))).toThrow(
      E2EEnvironmentError
    );
  });

  it("rejects a non-loopback AI base URL", () => {
    const root = validRoot();
    expect(() =>
      loadE2EEnvironment({
        ...baseEnv(root),
        AIFETCHLY_E2E_AI_BASE_URL: "https://api.openai.com/v1",
      })
    ).toThrow(E2EEnvironmentError);
  });

  it("rejects an https loopback URL (must be http) and a non-loopback allowed origin", () => {
    const root = validRoot();
    expect(() =>
      loadE2EEnvironment({
        ...baseEnv(root),
        AIFETCHLY_E2E_AI_BASE_URL: "https://127.0.0.1:5174/v1",
      })
    ).toThrow(E2EEnvironmentError);
    expect(() =>
      loadE2EEnvironment({
        ...baseEnv(root),
        AIFETCHLY_E2E_ALLOWED_ORIGINS: "https://example.com",
      })
    ).toThrow(E2EEnvironmentError);
  });

  it("rejects a state file path that escapes the root", () => {
    const root = validRoot();
    expect(() =>
      loadE2EEnvironment({
        ...baseEnv(root),
        AIFETCHLY_E2E_STATE_FILE: path.join(os.tmpdir(), "outside.json"),
      })
    ).toThrow(E2EEnvironmentError);
  });

  describe("parseStateManifest", () => {
    const validManifest = {
      schemaVersion: 1,
      authState: "authenticated",
      aiState: "local-enabled",
      locale: "en",
      fakeAiBaseUrl: "http://127.0.0.1:9000/v1",
      workspacePath: "/tmp/aifetchly-e2e/ws",
    };

    it("parses a valid manifest", () => {
      const file = path.join(validRoot(), "state.json");
      roots.push(path.dirname(file));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(validManifest), "utf8");
      const m = parseStateManifest(file);
      expect(m.aiState).toBe("local-enabled");
      expect(m.authState).toBe("authenticated");
    });

    it("rejects an unknown key", () => {
      const root = validRoot();
      roots.push(root);
      const file = path.join(root, "state.json");
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({ ...validManifest, evil: "x" }),
        "utf8"
      );
      expect(() => parseStateManifest(file)).toThrow(E2EEnvironmentError);
    });

    it("rejects the wrong schema version", () => {
      const root = validRoot();
      roots.push(root);
      const file = path.join(root, "state.json");
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({ ...validManifest, schemaVersion: 2 }),
        "utf8"
      );
      expect(() => parseStateManifest(file)).toThrow(E2EEnvironmentError);
    });

    it("rejects an invalid aiState", () => {
      const root = validRoot();
      roots.push(root);
      const file = path.join(root, "state.json");
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({ ...validManifest, aiState: "weird" }),
        "utf8"
      );
      expect(() => parseStateManifest(file)).toThrow(E2EEnvironmentError);
    });

    it("rejects a non-loopback fakeAiBaseUrl in the manifest", () => {
      const root = validRoot();
      roots.push(root);
      const file = path.join(root, "state.json");
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({
          ...validManifest,
          fakeAiBaseUrl: "https://api.openai.com/v1",
        }),
        "utf8"
      );
      expect(() => parseStateManifest(file)).toThrow(E2EEnvironmentError);
    });
  });
});
