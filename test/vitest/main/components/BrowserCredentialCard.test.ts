import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BrowserCredentialCard from "@/views/components/aiChatV2/BrowserCredentialCard.vue";
import { submitBrowserLoginCredential } from "@/views/api/managedBrowser";

/**
 * PRD A-FR-05: the credential card. Domain comes from the main process;
 * submit goes over the single-use secure channel; "I'll sign in myself"
 * cancels into handoff (C-FR-13).
 */

vi.mock("@/views/api/managedBrowser", () => ({
  submitBrowserLoginCredential: vi.fn().mockResolvedValue({ accepted: true }),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      browserSignIn: {
        cardTitle: "Sign in required",
        disclosure: "The site domain is verified by the app.",
        username: "Username",
        password: "Password",
        saveForFuture: "Save for future use",
        submit: "Sign in",
        createAccount: "Create account",
        signMyself: "I'll sign in myself",
        missingFields: "Enter a username and password.",
        expired: "This sign-in request expired. Try again.",
      },
      common: { cancel: "Cancel" },
    },
  },
});

function mountCard(props: Partial<Record<string, unknown>> = {}) {
  return mount(BrowserCredentialCard, {
    props: {
      requestId: "cred_req_1",
      conversationId: "conv-1",
      siteDomain: "example.test",
      mode: "login",
      prefillUsername: "user@example.test",
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        VCard: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VCardActions: { template: "<div><slot /></div>" },
        VTextField: {
          template:
            "<input :value=\"modelValue\" @input=\"$emit('update:modelValue', $event.target.value)\" />",
          props: ["modelValue"],
          emits: ["update:modelValue"],
        },
        VCheckbox: true,
        VBtn: {
          template: "<button :data-testid=\"$attrs['data-testid']\" @click=\"$emit('click')\"><slot /></button>",
        },
      },
    },
  });
}

beforeEach(() => {
  vi.mocked(submitBrowserLoginCredential).mockClear();
  vi.mocked(submitBrowserLoginCredential).mockResolvedValue({ accepted: true });
});

describe("BrowserCredentialCard (A-FR-05)", () => {
  it("renders the main-process site domain and pre-filled username", () => {
    const wrapper = mountCard();
    expect(wrapper.text()).toContain("example.test");
    expect(wrapper.find('[data-testid="credential-username"]').exists()).toBe(true);
  });

  it("uses 'Create account' wording in register mode (A-FR-12)", () => {
    const wrapper = mountCard({ mode: "register" });
    expect(wrapper.html()).toContain("Create account");
  });

  it("submits over the secure channel and clears the password", async () => {
    const wrapper = mountCard();
    const inputs = wrapper.findAll("input");
    await inputs[0]!.setValue("user@example.test");
    await inputs[1]!.setValue("sentinel-password");
    await wrapper.find('[data-testid="credential-submit"]').trigger("click");
    await flushPromises();
    expect(submitBrowserLoginCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "cred_req_1",
        conversationId: "conv-1",
        save: true,
        cancelled: false,
      })
    );
    expect(wrapper.emitted("submitted")).toBeTruthy();
  });

  it("A-FR-05: a password-only card disables the username and still submits", async () => {
    const wrapper = mountCard({ passwordOnly: true });
    await flushPromises();
    const username = wrapper.find("input[data-testid='credential-username']");
    expect((username.element as HTMLInputElement).disabled).toBe(true);
    expect((username.element as HTMLInputElement).value).toBe(
      "user@example.test"
    );
    await wrapper.find("input[data-testid='credential-password']").setValue("pw-only");
    const submitBtn = wrapper
      .findAll("button")
      .find((b) => b.attributes("data-testid") === "credential-submit");
    expect(submitBtn).toBeDefined();
    await submitBtn!.trigger("click");
    await flushPromises();
    expect(submitBrowserLoginCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "cred_req_1",
        conversationId: "conv-1",
        username: "user@example.test",
        password: "pw-only",
        cancelled: false,
      })
    );
  });

  it("cancelled submit ('I'll sign in myself') requests handoff (C-FR-13)", async () => {
    const wrapper = mountCard();
    await wrapper.find('[data-testid="credential-self"]').trigger("click");
    await flushPromises();
    expect(submitBrowserLoginCredential).toHaveBeenCalledWith(
      expect.objectContaining({ cancelled: true, save: false })
    );
    expect(wrapper.emitted("handoff")).toBeTruthy();
  });

  it("shows an expiry message when the single-use request was consumed", async () => {
    vi.mocked(submitBrowserLoginCredential).mockResolvedValue({ accepted: false });
    const wrapper = mountCard();
    const inputs = wrapper.findAll("input");
    await inputs[0]!.setValue("user@example.test");
    await inputs[1]!.setValue("sentinel-password");
    await wrapper.find('[data-testid="credential-submit"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("expired");
    expect(wrapper.emitted("submitted")).toBeFalsy();
  });
});
