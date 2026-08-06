import { describe, expect, it, vi } from "vitest";
import { patchSessionExtensionsApi } from "@/main-process/devtools/patchSessionExtensionsApi";

describe("patchSessionExtensionsApi", () => {
  it("forwards Session.loadExtension to session.extensions.loadExtension", async () => {
    const loadExtension = vi.fn(async () => ({ name: "Vue.js devtools" }));
    const removeExtension = vi.fn();
    const getExtension = vi.fn(() => null);
    const getAllExtensions = vi.fn(() => []);

    const targetSession = {
      extensions: {
        loadExtension,
        removeExtension,
        getExtension,
        getAllExtensions,
      },
      // Start with deprecated-shaped stubs so the patch overwrites them.
      loadExtension: vi.fn(),
      removeExtension: vi.fn(),
      getExtension: vi.fn(),
      getAllExtensions: vi.fn(),
    };

    const patched = patchSessionExtensionsApi(targetSession);
    expect(patched).toBe(true);

    await targetSession.loadExtension("/tmp/ext", { allowFileAccess: true });
    expect(loadExtension).toHaveBeenCalledWith("/tmp/ext", {
      allowFileAccess: true,
    });

    targetSession.removeExtension("ext-id");
    expect(removeExtension).toHaveBeenCalledWith("ext-id");

    targetSession.getExtension("ext-id");
    expect(getExtension).toHaveBeenCalledWith("ext-id");

    targetSession.getAllExtensions();
    expect(getAllExtensions).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when session.extensions is unavailable", () => {
    expect(patchSessionExtensionsApi({})).toBe(false);
  });
});
