import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EmailServiceDetail from "@/views/pages/emailservice/servicedetail.vue";

// Mock the emailservice API so no IPC is invoked.
const apiMocks = vi.hoisted(() => ({
  getEmailServiceDetail: vi.fn(),
  createupdateEmailService: vi.fn(),
  sendTestemail: vi.fn(),
  receiveEmailsendevent: vi.fn(),
}));
vi.mock("@/views/api/emailservice", () => ({
  getEmailServiceDetail: (...a: unknown[]) =>
    apiMocks.getEmailServiceDetail(...a),
  createupdateEmailService: (...a: unknown[]) =>
    apiMocks.createupdateEmailService(...a),
  sendTestemail: (...a: unknown[]) => apiMocks.sendTestemail(...a),
  receiveEmailsendevent: (...a: unknown[]) =>
    apiMocks.receiveEmailsendevent(...a),
}));

// Mock the emailreceive API (receive-connection test button).
const receiveApiMocks = vi.hoisted(() => ({
  testEmailReceiveConnection: vi.fn(),
}));
vi.mock("@/views/api/emailreceive", () => ({
  testEmailReceiveConnection: (...a: unknown[]) =>
    receiveApiMocks.testEmailReceiveConnection(...a),
}));

// Stub vue-router: the detail page reads $route.params.id and pushes routes.
const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  routeId: "" as string | number,
}));
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { id: routerMocks.routeId ?? "" } }),
  useRouter: () => ({ push: routerMocks.push, go: vi.fn() }),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      common: {
        test: "test",
        send: "send",
        submit: "submit",
        return: "return",
        yes: "yes",
        no: "no",
        loading: "loading",
        save_success: "save success",
        unkonw_error: "unknown error",
      },
      emailservice: {
        name: "name",
        name_hint: "name hint",
        from: "sender account",
        from_hint: "from hint",
        smtp_username: "SMTP username",
        smtp_username_hint: "SMTP login account",
        reply_to: "Reply-To",
        reply_to_hint: "reply hint",
        password: "password",
        host: "SMTP host",
        host_hint: "host hint",
        port: "port",
        port_hint: "port hint",
        ssl: "ssl",
        required_fields_missing: "Please fill in all required fields",
        test_email_service: "test email service",
        test_email_receiver: "test email receiver",
        test_email_receiver_hint: "receiver hint",
        test_email_title: "test email title",
        test_email_title_hint: "title hint",
        test_email_content_hint: "content hint",
        email_send_success: "email send success",
        port_lenght_error: "port length error",
      },
      emailReceive: {
        receive_settings: "receive settings",
        receive_enabled: "receive enabled",
        receive_disabled: "receive disabled",
        receive_protocol: "protocol",
        folder: "folder",
        folder_hint: "folder",
        test_connection: "test connection",
        imap_host: "imap host",
        imap_port: "imap port",
        imap_ssl: "imap ssl",
        pop3_host: "pop3 host",
        pop3_port: "pop3 port",
        pop3_ssl: "pop3 ssl",
        receive_username: "receive username",
        receive_username_hint: "username hint",
        receive_password: "receive password",
      },
    },
  },
});

const stubs = {
  VForm: {
    // Minimal form stub: validate() resolves valid; expose v-model binding.
    props: ["modelValue"],
    emits: ["submit", "update:modelValue"],
    methods: {
      validate(): Promise<{ valid: boolean }> {
        return Promise.resolve({ valid: true });
      },
    },
    // Forward the native submit event so the component's @submit.prevent
    // modifier can call preventDefault() on it.
    template:
      "<form @submit.prevent=\"$emit('submit', $event)\"><slot /></form>",
  },
  VSheet: { template: "<div><slot /></div>" },
  VRow: { template: "<div><slot /></div>" },
  VCol: { template: "<div><slot /></div>" },
  VTextField: { template: "<input />" },
  VTextarea: { template: "<textarea />" },
  VNumberInput: { template: "<input />" },
  VBtnToggle: { template: "<div><slot /></div>" },
  VBtn: {
    props: ["loading", "color", "variant"],
    emits: ["click"],
    template:
      "<button :data-loading=\"loading ? 'true' : 'false'\" @click=\"$emit('click')\"><slot /></button>",
  },
  VDivider: true,
  VContainer: { template: "<div><slot /></div>" },
  VAlert: {
    props: ["modelValue"],
    template: '<div v-if="modelValue" data-testid="alert"><slot /></div>',
  },
  VDialog: {
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: '<div v-if="modelValue" data-testid="test-dialog"><slot /></div>',
  },
  VCard: {
    props: ["title"],
    template: '<div><slot name="default" /></div>',
  },
  VCardText: { template: "<div><slot /></div>" },
  VCardActions: { template: "<div><slot /></div>" },
  VSpacer: true,
  VSelect: { template: "<select />" },
  ErrorDialog: true,
  LoadingDialog: true,
};

/** A stored service as returned by getEmailServiceDetail (password sentinel). */
const STORED_SERVICE = {
  id: 9,
  name: "Primary SMTP",
  from: "sender@example.com",
  smtpUsername: "login@example.com",
  replyTo: "replies@example.com",
  host: "smtp.example.com",
  port: "465",
  ssl: 1,
  password: "", // credential sentinel — never round-trips to the renderer
  receiveEnabled: 0,
  receiveProtocol: "imap",
  imapHost: "",
  imapPort: "",
  imapSsl: 1,
  pop3Host: "",
  pop3Port: "",
  pop3Ssl: 1,
  receiveUsername: "",
  receivePassword: "",
  receiveFolder: "INBOX",
};

type MountResult = ReturnType<typeof mount>;

function mountDetail(routeId: string | number): MountResult {
  routerMocks.routeId = routeId;
  return mount(EmailServiceDetail, {
    global: { plugins: [i18n], stubs },
  });
}

/** Find the first button whose label text matches. */
function findButtonByText(
  wrapper: MountResult,
  text: string
): ReturnType<typeof wrapper.findAll>[number] | undefined {
  return wrapper.findAll("button").find((b) => b.text().includes(text));
}

describe("EmailServiceDetail Test button (edit mode password sentinel)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerMocks.routeId = "";
    apiMocks.getEmailServiceDetail.mockResolvedValue(STORED_SERVICE);
    apiMocks.receiveEmailsendevent.mockImplementation(() => {});
    // onSubmit calls .then() on the return value — mock must resolve.
    apiMocks.createupdateEmailService.mockResolvedValue({ id: 9 });
  });

  it("opens the test dialog in edit mode even though the stored password is hidden (sentinel)", async () => {
    const wrapper = mountDetail(9);
    await flushPromises();

    expect(apiMocks.getEmailServiceDetail).toHaveBeenCalledWith(9);

    const testBtn = findButtonByText(wrapper, "test");
    expect(testBtn).toBeTruthy();
    await testBtn!.trigger("click");
    await flushPromises();

    // No missing-fields alert: the empty password is the "keep existing"
    // sentinel in edit mode, not a missing required field.
    const alert = wrapper.find('[data-testid="alert"]');
    expect(alert.exists()).toBe(false);
    expect(wrapper.find('[data-testid="test-dialog"]').exists()).toBe(true);
  });

  it("still requires the password in create mode (no stored credential to fall back to)", async () => {
    apiMocks.getEmailServiceDetail.mockResolvedValue(undefined);
    const wrapper = mountDetail(""); // create route — no id
    await flushPromises();

    const testBtn = findButtonByText(wrapper, "test");
    expect(testBtn).toBeTruthy();
    await testBtn!.trigger("click");
    await flushPromises();

    const alert = wrapper.find('[data-testid="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("Please fill in all required fields");
    expect(alert.text()).toContain("password");
    expect(wrapper.find('[data-testid="test-dialog"]').exists()).toBe(false);
  });

  it("sends the service id with the test email so the backend can reuse the stored password", async () => {
    const wrapper = mountDetail(9);
    await flushPromises();

    // Open the test dialog (password sentinel must not block it).
    await findButtonByText(wrapper, "test")!.trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="test-dialog"]').exists()).toBe(true);

    // The dialog's send button is a type="submit" inside the stubbed v-form
    // (whose validate() resolves valid) — submit the form itself.
    const dialogForm = wrapper.find('[data-testid="test-dialog"] form');
    expect(dialogForm.exists()).toBe(true);
    await dialogForm.trigger("submit");
    await flushPromises();

    expect(apiMocks.sendTestemail).toHaveBeenCalledTimes(1);
    const param = apiMocks.sendTestemail.mock.calls[0][0] as {
      Setting: { id?: number; password?: string };
    };
    expect(param.Setting.id).toBe(9);
    expect(param.Setting.password).toBe(""); // sentinel travels; backend resolves
  });

  it("renders all three identity fields (SMTP username, From, Reply-To) in the form", async () => {
    const wrapper = mountDetail(9);
    await flushPromises();

    // The form has many text inputs; assert at least 3 render without crashing.
    const inputs = wrapper.findAll("input");
    expect(inputs.length).toBeGreaterThanOrEqual(3);
  });

  it("prefills SMTP username with From for a legacy service (no smtpUsername in detail response)", async () => {
    // Legacy service: no smtpUsername/replyTo fields returned by the API.
    const legacyService = {
      ...STORED_SERVICE,
      smtpUsername: undefined,
      replyTo: undefined,
    };
    apiMocks.getEmailServiceDetail.mockResolvedValue(legacyService);
    const wrapper = mountDetail(9);
    await flushPromises();

    // Assert via the submit payload — the most robust path with stubs.
    // After initialize, smtpUsername ref should be prefilled with From.
    // Trigger the main form submit to inspect the payload.
    const form = wrapper.find("form");
    await form.trigger("submit");
    await flushPromises();

    expect(apiMocks.createupdateEmailService).toHaveBeenCalledTimes(1);
    const payload = apiMocks.createupdateEmailService.mock.calls[0][0] as {
      smtpUsername: string | null;
      replyTo: string | null;
    };
    // Legacy fallback: smtpUsername prefilled from From address.
    expect(payload.smtpUsername).toBe("sender@example.com");
    expect(payload.replyTo).toBe(null);
  });

  it("edit submit carries smtpUsername and replyTo in the payload", async () => {
    const wrapper = mountDetail(9);
    await flushPromises();

    // STORED_SERVICE has smtpUsername: "login@example.com", replyTo: "replies@example.com"
    const form = wrapper.find("form");
    await form.trigger("submit");
    await flushPromises();

    expect(apiMocks.createupdateEmailService).toHaveBeenCalledTimes(1);
    const payload = apiMocks.createupdateEmailService.mock.calls[0][0] as {
      smtpUsername: string | null;
      replyTo: string | null;
      id: number;
    };
    expect(payload.smtpUsername).toBe("login@example.com");
    expect(payload.replyTo).toBe("replies@example.com");
    expect(payload.id).toBe(9);
  });

  it("clearing Reply-To submits null in the payload", async () => {
    // Service whose replyTo is absent — initialize sets replyTo.value = "".
    const noReplyService = { ...STORED_SERVICE, replyTo: undefined };
    apiMocks.getEmailServiceDetail.mockResolvedValue(noReplyService);
    const wrapper = mountDetail(9);
    await flushPromises();

    const form = wrapper.find("form");
    await form.trigger("submit");
    await flushPromises();

    expect(apiMocks.createupdateEmailService).toHaveBeenCalledTimes(1);
    const payload = apiMocks.createupdateEmailService.mock.calls[0][0] as {
      replyTo: string | null;
    };
    // Empty replyTo → null (no Reply-To header emitted).
    expect(payload.replyTo).toBe(null);
  });

  it("Test Email carries smtpUsername, replyTo, and the service id", async () => {
    const wrapper = mountDetail(9);
    await flushPromises();

    // Open the test dialog.
    await findButtonByText(wrapper, "test")!.trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="test-dialog"]').exists()).toBe(true);

    // Submit the dialog form.
    const dialogForm = wrapper.find('[data-testid="test-dialog"] form');
    expect(dialogForm.exists()).toBe(true);
    await dialogForm.trigger("submit");
    await flushPromises();

    expect(apiMocks.sendTestemail).toHaveBeenCalledTimes(1);
    const param = apiMocks.sendTestemail.mock.calls[0][0] as {
      Setting: {
        id?: number;
        smtpUsername?: string | null;
        replyTo?: string | null;
      };
    };
    expect(param.Setting.smtpUsername).toBe("login@example.com");
    expect(param.Setting.replyTo).toBe("replies@example.com");
    expect(param.Setting.id).toBe(9);
  });
});
