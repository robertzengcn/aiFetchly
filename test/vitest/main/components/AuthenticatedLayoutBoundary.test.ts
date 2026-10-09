import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { shallowMount } from "@vue/test-utils";
import AuthenticatedLayoutBoundary from "@/views/layout/AuthenticatedLayoutBoundary.vue";
import { useInnerPageShellFlag } from "@/views/composables/useInnerPageShellFlag";

/**
 * Rollback escape-hatch contract: the converged shell flag must switch the
 * rendered shell in BOTH directions at runtime. Regression: once the flag
 * was "false" (legacy drawer on every page, including the dashboard) there
 * was no path back — the toggle lives in the new shell's sidebar, so legacy
 * mode was a one-way door. The legacy drawer now offers a restore action
 * (layout-restore-shell) that flips this same flag back on.
 */
describe("AuthenticatedLayoutBoundary shell rollback round-trip", () => {
  it("renders the legacy layout while the flag is off", () => {
    useInnerPageShellFlag().setShellEnabled(false);
    const wrapper = shallowMount(AuthenticatedLayoutBoundary);
    expect(wrapper.find("layout-stub").exists()).toBe(true);
    expect(
      wrapper.find("authenticated-workspace-layout-stub").exists()
    ).toBe(false);
    wrapper.unmount();
  });

  it("switches back to the converged shell when the flag is re-enabled", async () => {
    useInnerPageShellFlag().setShellEnabled(false);
    const wrapper = shallowMount(AuthenticatedLayoutBoundary);
    expect(wrapper.find("layout-stub").exists()).toBe(true);

    // The legacy drawer's restore action path: flag back on.
    useInnerPageShellFlag().setShellEnabled(true);
    await nextTick();

    expect(
      wrapper.find("authenticated-workspace-layout-stub").exists()
    ).toBe(true);
    expect(wrapper.find("layout-stub").exists()).toBe(false);
    wrapper.unmount();
  });

  it("defaults the shell flag to on for first run", async () => {
    localStorage.clear();
    vi.resetModules();
    const mod = await import("@/views/composables/useInnerPageShellFlag");
    expect(mod.useInnerPageShellFlag().shellEnabled.value).toBe(true);
  });
});
