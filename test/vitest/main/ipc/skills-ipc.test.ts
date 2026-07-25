import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SKILL_LIST_INSTALLED,
  SKILL_TOGGLE,
} from "@/config/channellist";

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

const mocks = vi.hoisted(() => ({
  listInstalledSkills: vi.fn(async () => [
    {
      name: "pdf",
      enabled: 1,
      manifest_json: JSON.stringify({ permissions: [] }),
    },
  ]),
  toggleSkill: vi.fn(async () => true),
  unregisterSkill: vi.fn(),
  loadPersistedSkill: vi.fn(async () => true),
  broadcastAifetchlyConfigChanged: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/aifetchly-test"),
  },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
  },
}));

vi.mock("@/service/AiFeatureGate", () => ({
  isAiEnabled: vi.fn(() => false),
}));

vi.mock("@/modules/SkillManagementModule", () => ({
  SkillManagementModule: vi.fn().mockImplementation(() => ({
    listInstalledSkills: mocks.listInstalledSkills,
    toggleSkill: mocks.toggleSkill,
  })),
}));

vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: {
    unregisterSkill: mocks.unregisterSkill,
  },
}));

vi.mock("@/service/SkillImportService", () => ({
  SkillImportService: {
    importFromZip: vi.fn(),
    loadPersistedSkill: mocks.loadPersistedSkill,
  },
}));

vi.mock("@/service/SkillPermissionService", () => ({
  SkillPermissionService: {
    checkPermission: vi.fn(),
    grantPermission: vi.fn(),
    denyPermission: vi.fn(),
    revokePermission: vi.fn(),
    getPermissionStatus: vi.fn(),
  },
}));

vi.mock("@/main-process/communication/aifetchlyConfigEvents", () => ({
  broadcastAifetchlyConfigChanged: mocks.broadcastAifetchlyConfigChanged,
}));

import { registerSkillsIpcHandlers } from "@/main-process/communication/skills-ipc";

function invoke(
  channel: string,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`missing handler: ${channel}`);
  return handler({}, JSON.stringify(payload));
}

describe("skills-ipc management handlers", () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    mocks.listInstalledSkills.mockResolvedValue([
      {
        name: "pdf",
        enabled: 1,
        manifest_json: JSON.stringify({ permissions: [] }),
      },
    ]);
    mocks.toggleSkill.mockResolvedValue(true);
    mocks.loadPersistedSkill.mockResolvedValue(true);
    registerSkillsIpcHandlers();
  });

  it("lists installed skills even when AI is disabled", async () => {
    const result = await invoke(SKILL_LIST_INSTALLED);

    expect(result).toMatchObject({
      status: true,
      data: {
        skills: [
          {
            name: "pdf",
            enabled: 1,
          },
        ],
      },
    });
  });

  it("disables a skill even when AI is disabled and updates runtime catalog", async () => {
    const result = await invoke(SKILL_TOGGLE, {
      skillName: "pdf",
      enabled: false,
    });

    expect(result).toMatchObject({ status: true });
    expect(mocks.toggleSkill).toHaveBeenCalledWith("pdf", false);
    expect(mocks.unregisterSkill).toHaveBeenCalledWith("pdf");
    expect(mocks.broadcastAifetchlyConfigChanged).toHaveBeenCalledWith({
      source: "skill",
    });
  });

  it("accepts legacy enable payloads from stale renderer builds", async () => {
    const result = await invoke(SKILL_TOGGLE, {
      skillName: "pdf",
      enable: false,
    });

    expect(result).toMatchObject({ status: true });
    expect(mocks.toggleSkill).toHaveBeenCalledWith("pdf", false);
    expect(mocks.unregisterSkill).toHaveBeenCalledWith("pdf");
  });

  it("reloads a skill into the runtime catalog when re-enabled", async () => {
    const result = await invoke(SKILL_TOGGLE, {
      skillName: "pdf",
      enabled: true,
    });

    expect(result).toMatchObject({ status: true });
    expect(mocks.toggleSkill).toHaveBeenCalledWith("pdf", true);
    expect(mocks.loadPersistedSkill).toHaveBeenCalledWith("pdf");
    expect(mocks.unregisterSkill).not.toHaveBeenCalled();
  });
});
