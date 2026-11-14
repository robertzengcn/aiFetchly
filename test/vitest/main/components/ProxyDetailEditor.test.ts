import { describe, expect, it, vi, beforeEach } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

/**
 * B10/P-FR-07: the proxy editor never receives the stored password, and
 * submits one ONLY when the user typed one — an untouched submit keeps
 * the stored credential (the model's T11 semantics).
 */

const getProxyMock = vi.fn();
const saveProxyMock = vi.fn();

vi.mock("@/views/api/proxy", () => ({
  getProxy: (...args: unknown[]) => getProxyMock(...args),
  saveProxy: (...args: unknown[]) => saveProxyMock(...args),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { id: "5" } }),
  useRouter: () => ({ go: vi.fn(), push: vi.fn() }),
}));

import ProxyDetail from "@/views/pages/proxy/proxydetail.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      proxy: {
        id: "Id",
        host: "Host",
        host_hint: "host",
        port: "Port",
        port_hint: "port",
        user_name: "User",
        user_hint: "user",
        password: "Password",
        password_hint: "leave empty to keep",
        protocol: "Protocol",
        status: "Status",
      },
      route: { edit_proxy: "Edit proxy", add_proxy: "Add proxy", proxy_list: "Proxies" },
      common: { submit: "Submit", return: "Return", information: "Info", close: "Close" },
    },
  },
});

// Binds v-model and renders a real input so tests can type into it.
const VTextField = defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: [String, Number], default: "" } },
  emits: ["update:modelValue"],
  template: `<input :value="String(modelValue)" @input="$emit('update:modelValue', $event.target.value)" />`,
});

const VForm = defineComponent({
  name: "VForm",
  emits: ["submit"],
  setup(_, { expose }) {
    // The page calls form.value.validate() through the template ref —
    // script-setup children expose exactly what defineExpose lists.
    expose({
      validate: async (): Promise<{ valid: boolean }> => ({ valid: true }),
    });
  },
  template: `<form @submit.prevent="$emit('submit', $event)"><slot /></form>`,
});

const AppPageShell = defineComponent({
  template: `<div><slot name="context" /><slot /></div>`,
});

function mountEditor() {
  return mount(ProxyDetail, {
    global: {
      plugins: [i18n],
      stubs: {
        "v-text-field": VTextField,
        "v-select": VTextField,
        "v-form": VForm,
        "v-btn": { template: `<button @click="$emit('click')"><slot /></button>` },
        "v-alert": { template: `<div><slot /></div>` },
        "v-sheet": { template: `<div><slot /></div>` },
        "v-icon": { template: `<i />` },
        AppPageShell,
      },
    },
  });
}

beforeEach(() => {
  getProxyMock.mockReset();
  saveProxyMock.mockReset();
  // B10: the detail API returns hasPassword — NEVER a password value.
  getProxyMock.mockResolvedValue({
    id: 5,
    host: "proxy.test",
    port: "8080",
    user: "alice",
    hasPassword: true,
    protocol: "http",
    country_code: "DE",
    addtime: "2026-11-14",
  });
  saveProxyMock.mockResolvedValue({ status: true, code: 200, data: { id: 5 } });
});

describe("ProxyDetail editor (B10 password handling)", () => {
  it("never prefills the password field from the stored credential", async () => {
    const wrapper = mountEditor();
    await flushPromises();
    const inputs = wrapper.findAll("input");
    // Field order: id, host, port, user, password, protocol.
    const passwordInput = inputs[4]!;
    expect((passwordInput.element as HTMLInputElement).value).toBe("");
  });

  it("submits WITHOUT a pass when the password field is untouched", async () => {
    const wrapper = mountEditor();
    await flushPromises();
    const form = wrapper.find("form");
    await form.trigger("submit");
    await flushPromises();
    expect(saveProxyMock).toHaveBeenCalledTimes(1);
    const payload = saveProxyMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.host).toBe("proxy.test");
    expect(payload.pass).toBeUndefined();
  });

  it("submits the typed password only when the user enters one", async () => {
    const wrapper = mountEditor();
    await flushPromises();
    const inputs = wrapper.findAll("input");
    const passwordInput = inputs[4]!;
    await passwordInput.setValue("brand-new-secret");
    const form = wrapper.find("form");
    await form.trigger("submit");
    await flushPromises();
    expect(saveProxyMock).toHaveBeenCalledTimes(1);
    const payload = saveProxyMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.pass).toBe("brand-new-secret");
  });
});
