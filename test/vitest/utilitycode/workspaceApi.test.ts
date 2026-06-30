import { afterEach, describe, expect, it, vi } from "vitest";
import { DIALOG_PICK_FOLDER } from "@/config/channellist";
import { pickFolder } from "@/views/api/workspace";

describe("workspace renderer API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unwraps the folder picker IPC response", async () => {
    const invoke = vi.fn().mockResolvedValue({
      status: true,
      msg: "",
      data: "/tmp/workspace",
    });
    vi.stubGlobal("window", {
      api: { invoke },
    });

    await expect(pickFolder()).resolves.toBe("/tmp/workspace");
    expect(invoke).toHaveBeenCalledWith(DIALOG_PICK_FOLDER, undefined);
  });

  it("throws the IPC denial message when folder picking is rejected", async () => {
    vi.stubGlobal("window", {
      api: {
        invoke: vi.fn().mockResolvedValue({
          status: false,
          msg: "AI functionality is only available to subscribers.",
        }),
      },
    });

    await expect(pickFolder()).rejects.toThrow(
      "AI functionality is only available to subscribers."
    );
  });
});
