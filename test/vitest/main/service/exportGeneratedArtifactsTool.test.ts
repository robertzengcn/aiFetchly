import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGeneratedImageProtocolUrl,
  getGeneratedImageUserRoot,
} from "@/service/AIChatGeneratedImageProtocol";
import {
  EXPORT_GENERATED_ARTIFACTS_TOOL,
  ExportGeneratedArtifactsService,
  type ExportGeneratedArtifactsDeps,
  type ExportGeneratedArtifactsResult,
} from "@/service/agentTools/exportGeneratedArtifactsTool";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";

const USER_EMAIL = "owner@example.com";

function context(signal?: AbortSignal): SkillExecutionContext {
  return {
    conversationId: "conversation-1",
    toolCallId: "call-1",
    signal,
  };
}

describe("ExportGeneratedArtifactsService", () => {
  let tempRoot: string;
  let userDataPath: string;
  let workspacePath: string;

  beforeEach(async (): Promise<void> => {
    tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "artifact-export-test-")
    );
    userDataPath = path.join(tempRoot, "user-data");
    workspacePath = path.join(tempRoot, "workspace");
    await fs.mkdir(workspacePath, { recursive: true });
  });

  afterEach(async (): Promise<void> => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  async function createArtifact(
    input: {
      userEmail?: string;
      fileName?: string;
      contents?: string;
    } = {}
  ): Promise<{ url: string; path: string }> {
    const userEmail = input.userEmail ?? USER_EMAIL;
    const fileName = input.fileName ?? "image-1.png";
    const artifactPath = path.join(
      getGeneratedImageUserRoot(userDataPath, userEmail),
      "conversation",
      "message",
      fileName
    );
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, input.contents ?? "generated-data");
    return {
      url: buildGeneratedImageProtocolUrl({
        userEmail,
        conversationId: "conversation",
        messageId: "message",
        fileName,
      }),
      path: artifactPath,
    };
  }

  function deps(): ExportGeneratedArtifactsDeps {
    return {
      resolveWorkspace: vi.fn(async () => ({ rootPath: workspacePath })),
      getUserDataPath: () => userDataPath,
      getCurrentUserEmail: () => USER_EMAIL,
      lstat: fs.lstat,
      mkdir: fs.mkdir,
      copyFile: fs.copyFile,
      access: fs.access,
      realpath: fs.realpath,
    };
  }

  it("exports an owned generated artifact into the approved workspace", async () => {
    const artifact = await createArtifact();
    const service = new ExportGeneratedArtifactsService(deps());

    const response = await service.execute(
      {
        artifacts: [
          { artifactUrl: artifact.url, destination: "outputs/white-bg.png" },
        ],
      },
      context()
    );

    expect(response.success).toBe(true);
    const result = response.result as ExportGeneratedArtifactsResult;
    expect(result.status).toBe("completed");
    expect(result.items[0].destination).toBe(
      path.join(workspacePath, "outputs", "white-bg.png")
    );
    const exportedPath = result.items[0].destination;
    expect(typeof exportedPath).toBe("string");
    expect(await fs.readFile(exportedPath ?? "", "utf8")).toBe(
      "generated-data"
    );
  });

  it("renames collisions by default without overwriting workspace files", async () => {
    const artifact = await createArtifact();
    await fs.writeFile(path.join(workspacePath, "image.png"), "original");
    const service = new ExportGeneratedArtifactsService(deps());

    const response = await service.execute(
      {
        artifacts: [{ artifactUrl: artifact.url, destination: "image.png" }],
      },
      context()
    );

    const result = response.result as ExportGeneratedArtifactsResult;
    expect(result.items[0].renamed).toBe(true);
    expect(result.items[0].destination).toBe(
      path.join(workspacePath, "image-1.png")
    );
    expect(
      await fs.readFile(path.join(workspacePath, "image.png"), "utf8")
    ).toBe("original");
  });

  it("supports explicitly confirmed overwrite semantics", async () => {
    const artifact = await createArtifact({ contents: "replacement" });
    const destination = path.join(workspacePath, "image.png");
    await fs.writeFile(destination, "original");
    const service = new ExportGeneratedArtifactsService(deps());

    const response = await service.execute(
      {
        artifacts: [{ artifactUrl: artifact.url, destination: "image.png" }],
        collisionPolicy: "overwrite",
      },
      context()
    );

    expect(response.success).toBe(true);
    expect(await fs.readFile(destination, "utf8")).toBe("replacement");
  });

  it("rejects artifacts belonging to another user", async () => {
    const artifact = await createArtifact({ userEmail: "other@example.com" });
    const service = new ExportGeneratedArtifactsService(deps());

    const response = await service.execute(
      { artifacts: [{ artifactUrl: artifact.url }] },
      context()
    );

    expect(response.success).toBe(false);
    const result = response.result as ExportGeneratedArtifactsResult;
    expect(result.items[0].error).toMatch(/not owned/i);
  });

  it("rejects absolute and traversal destinations outside the workspace", async () => {
    const artifact = await createArtifact();
    const service = new ExportGeneratedArtifactsService(deps());

    const absolute = await service.execute(
      {
        artifacts: [{ artifactUrl: artifact.url, destination: "/tmp/out.png" }],
      },
      context()
    );
    const traversal = await service.execute(
      {
        artifacts: [{ artifactUrl: artifact.url, destination: "../out.png" }],
      },
      context()
    );

    expect(
      (absolute.result as ExportGeneratedArtifactsResult).items[0].status
    ).toBe("failed");
    expect(
      (traversal.result as ExportGeneratedArtifactsResult).items[0].status
    ).toBe("failed");
  });

  it("rejects a nested destination whose existing ancestor is a symlink escape", async () => {
    const artifact = await createArtifact();
    const outside = path.join(tempRoot, "outside");
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, path.join(workspacePath, "escape"));
    const service = new ExportGeneratedArtifactsService(deps());

    const response = await service.execute(
      {
        artifacts: [
          {
            artifactUrl: artifact.url,
            destination: "escape/new-directory/out.png",
          },
        ],
      },
      context()
    );

    expect(
      (response.result as ExportGeneratedArtifactsResult).items[0].status
    ).toBe("failed");
    await expect(
      fs.access(path.join(outside, "new-directory"))
    ).rejects.toThrow();
  });

  it("fails closed when no workspace is approved", async () => {
    const artifact = await createArtifact();
    const exportDeps = deps();
    exportDeps.resolveWorkspace = vi.fn(async () => null);
    const copyFile = vi.spyOn(exportDeps, "copyFile");
    const service = new ExportGeneratedArtifactsService(exportDeps);

    const response = await service.execute(
      { artifacts: [{ artifactUrl: artifact.url }] },
      context()
    );

    expect(response.success).toBe(false);
    expect(copyFile).not.toHaveBeenCalled();
  });
});

describe("EXPORT_GENERATED_ARTIFACTS_TOOL", () => {
  it("is a confirmed filesystem tool with a generic artifact contract", () => {
    expect(EXPORT_GENERATED_ARTIFACTS_TOOL.requiresConfirmation).toBe(true);
    expect(EXPORT_GENERATED_ARTIFACTS_TOOL.permissionCategory).toBe(
      "filesystem"
    );
    expect(EXPORT_GENERATED_ARTIFACTS_TOOL.description).toMatch(
      /without shell/i
    );
    const properties = EXPORT_GENERATED_ARTIFACTS_TOOL.parameters
      .properties as Record<string, Record<string, unknown>>;
    expect(properties.artifacts.maxItems).toBe(50);
    expect(properties.collisionPolicy.enum).toEqual([
      "rename",
      "fail",
      "overwrite",
    ]);
  });

  it("shows source-to-destination mappings in its permission preview", () => {
    const preview = EXPORT_GENERATED_ARTIFACTS_TOOL.buildPermissionPreview?.({
      artifacts: [
        {
          artifactUrl: "aifetchly-generated-image://local/u/c/m/image.png",
          destination: "outputs/image.png",
        },
      ],
    });
    expect(preview?.items[0]).toContain("outputs/image.png");
  });
});
