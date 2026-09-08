import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { createI18n } from "vue-i18n";
import AppCenterRouteHost from "@/views/components/appShell/AppCenterRouteHost.vue";

/**
 * Focus transfer (PRD §16.3/§19.1, FR-QUAL-005): after a center-route change
 * the newly active center landmark receives focus — keyboard users are never
 * stranded on the navigation control they just left. The initial mount keeps
 * the app's default focus.
 */

vi.mock("@/views/composables/useInnerPageShellFlag", () => ({
  useInnerPageShellFlag: () => ({
    shellEnabled: { value: true },
    scheduleEnabled: { value: true },
    setShellEnabled: () => undefined,
    setScheduleEnabled: () => undefined,
  }),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { ui: { state: { loading: "Loading…" } } } },
});

const PageOne = defineComponent({
  template: '<div data-testid="page-one">one</div>',
});
const PageTwo = defineComponent({
  template: '<div data-testid="page-two">two</div>',
});

async function mountHost() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/one", name: "One", component: PageOne },
      { path: "/two", name: "Two", component: PageTwo },
    ],
  });
  await router.push("/one");
  await router.isReady();
  const wrapper = mount(AppCenterRouteHost, {
    // Focus assertions require the tree to be attached to the document — a
    // detached mount makes Element.focus() a no-op.
    attachTo: document.body,
    global: { plugins: [createPinia(), i18n, router] },
  });
  await flushPromises();
  return { wrapper, router };
}

function activeElementTestid(): string | null {
  const el = document.activeElement as HTMLElement | null;
  return el ? el.getAttribute("data-testid") : null;
}

describe("AppCenterRouteHost focus transfer (PRD §16.3/§19.1)", () => {
  beforeEach(() => {
    document.body.focus(); // reset focus between tests
  });

  afterEach(() => {
    document.body.innerHTML = ""; // detach attached trees
  });

  it("keeps the default focus on initial mount", async () => {
    await mountHost();
    expect(activeElementTestid()).not.toBe("app-center-route-host");
  });

  it("focuses the center landmark after a center-route change", async () => {
    const { wrapper, router } = await mountHost();
    expect(wrapper.find('[data-testid="app-center-route-host"]').exists()).toBe(
      true
    );
    expect(
      wrapper
        .get('[data-testid="app-center-route-host"]')
        .attributes("tabindex")
    ).toBe("-1");

    await router.push("/two");
    await flushPromises();

    expect(activeElementTestid()).toBe("app-center-route-host");
    expect(wrapper.find('[data-testid="page-two"]').exists()).toBe(true);
  });
});
