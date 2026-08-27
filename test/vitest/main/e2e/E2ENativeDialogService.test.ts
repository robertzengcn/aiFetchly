import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { E2ENativeDialogService } from "@/main-process/e2e/E2ENativeDialogService";
import type { E2EEnvironment } from "@/main-process/e2e/E2EEnvironment";

function makeEnv(root: string): E2EEnvironment {
  return {
    rootPath: root,
    userDataPath: path.join(root, "user-data"),
    databasePath: path.join(root, "database"),
    workspacePath: path.join(root, "workspace"),
    downloadsPath: path.join(root, "downloads"),
    logsPath: path.join(root, "logs"),
    fakeAiBaseUrl: "http://127.0.0.1:6000/v1",
    allowedOrigins: ["http://127.0.0.1:5173"],
    stateFilePath: path.join(root, "state.json"),
  };
}

function writeManifest(
  file: string,
  dialogResponses: Record<string, unknown>
): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 1,
      authState: "authenticated",
      aiState: "local-enabled",
      locale: "en",
      fakeAiBaseUrl: "http://127.0.0.1:6000/v1",
      workspacePath: "/tmp/aifetchly-e2e/ws",
      dialogResponses,
    }),
    "utf8"
  );
}

describe("E2ENativeDialogService", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-e2e-dlg-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns a configured confirmed open response with in-root paths", async () => {
    const inRoot = path.join(root, "pick.txt");
    writeManifest(path.join(root, "state.json"), {
      open: { action: "confirmed", paths: [inRoot] },
    });
    const svc = new E2ENativeDialogService(makeEnv(root), path.join(root, "state.json"));
    const result = await svc.showOpenDialog({ title: "pick" });
    expect(result.canceled).toBe(false);
    expect(result.filePaths).toEqual([inRoot]);
  });

  it("returns canceled when the configured action is canceled", async () => {
    writeManifest(path.join(root, "state.json"), {
      open: { action: "canceled" },
    });
    const svc = new E2ENativeDialogService(makeEnv(root), path.join(root, "state.json"));
    const result = await svc.showOpenDialog({});
    expect(result.canceled).toBe(true);
    expect(result.filePaths).toEqual([]);
  });

  it("fails closed when no response is configured for the dialog kind", async () => {
    writeManifest(path.join(root, "state.json"), {});
    const svc = new E2ENativeDialogService(makeEnv(root), path.join(root, "state.json"));
    await expect(svc.showSaveDialog({})).rejects.toThrow(
      /no response is configured/
    );
  });

  it("rejects paths that escape the E2E root (treats as canceled)", async () => {
    writeManifest(path.join(root, "state.json"), {
      open: { action: "confirmed", paths: ["/etc/passwd"] },
    });
    const svc = new E2ENativeDialogService(makeEnv(root), path.join(root, "state.json"));
    const result = await svc.showOpenDialog({});
    // The only configured path was outside the root -> no in-root paths -> canceled.
    expect(result.canceled).toBe(true);
  });

  it("maps a confirmed message box to response index 0", async () => {
    writeManifest(path.join(root, "state.json"), {
      message: { action: "confirmed" },
    });
    const svc = new E2ENativeDialogService(makeEnv(root), path.join(root, "state.json"));
    const result = await svc.showMessageBox({ message: "ok?" });
    expect(result.response).toBe(0);
  });
});
