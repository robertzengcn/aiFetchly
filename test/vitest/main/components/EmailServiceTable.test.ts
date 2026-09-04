import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmailServiceTable from '@/views/pages/emailservice/widgets/EmailServiceTable.vue';
import type { EmailServiceListdata } from '@/entityTypes/emailmarketingType';

// Mock the emailservice API so no IPC is invoked.
const apiMocks = vi.hoisted(() => ({
  getEmailServiceList: vi.fn(),
  deleteEmailService: vi.fn(),
  exportEmailServices: vi.fn(),
}));

vi.mock('@/views/api/emailservice', () => ({
  getEmailServiceList: (...args: unknown[]) =>
    apiMocks.getEmailServiceList(...args),
  deleteEmailService: (...args: unknown[]) =>
    apiMocks.deleteEmailService(...args),
  exportEmailServices: (...args: unknown[]) =>
    apiMocks.exportEmailServices(...args),
}));

// Stub vue-router's useRouter — component pushes routes on edit/create.
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      common: {
        export: 'Export',
        export_success: 'Export successful',
        export_failed: 'Export failed',
        export_cancelled: 'Export cancelled',
        actions: 'Actions',
        created_time: 'created time',
      },
      emailservice: {
        id: 'id',
        name: 'name',
        from: 'sender account',
        create_service: 'create email service',
      },
    },
  },
});

const stubs = {
  VTextField: { template: '<input />' },
  VBtn: {
    props: ['loading', 'prependIcon', 'variant', 'color'],
    emits: ['click'],
    template:
      '<button :data-loading="loading ? \'true\' : \'false\'" @click="$emit(\'click\')"><slot /></button>',
  },
  VDataTableServer: {
    props: [
      'items',
      'itemsLength',
      'loading',
      'headers',
      'itemsPerPage',
      'search',
      'itemValue',
      'showSelect',
      'modelValue',
    ],
    emits: ['update:options', 'update:modelValue'],
    template: '<div data-testid="v-data-table-server" />',
  },
  VIcon: true,
  DeleteDialog: true,
  NoticeSnackbar: {
    props: ['modelValue', 'message', 'type'],
    emits: ['update:modelValue'],
    template:
      '<div data-testid="notice-snackbar" :data-message="message" :data-type="type" v-if="modelValue" />',
  },
};

const SAMPLE: EmailServiceListdata[] = [
  {
    id: 1,
    name: 'Primary SMTP',
    from: 'a@example.com',
    host: 'smtp.example.com',
    receiveProtocol: 'imap',
    create_time: '2026-01-01T00:00:00.000Z',
  },
];

function mountTable(props: Record<string, unknown> = {}) {
  return mount(EmailServiceTable, {
    props,
    global: { plugins: [i18n], stubs },
  });
}

describe('EmailServiceTable export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getEmailServiceList.mockResolvedValue({ data: SAMPLE, total: 1 });
  });

  it('renders an export button (standalone list mode)', () => {
    const wrapper = mountTable();
    expect(
      wrapper.find('[data-testid="email-service-export-btn"]').exists()
    ).toBe(true);
  });

  it('hides the export button in selection mode (isSelectedtable=true)', () => {
    const wrapper = mountTable({ isSelectedtable: true });
    expect(
      wrapper.find('[data-testid="email-service-export-btn"]').exists()
    ).toBe(false);
  });

  it('calls exportEmailServices and shows a success notice on success', async () => {
    apiMocks.exportEmailServices.mockResolvedValue('/tmp/export.csv');
    const wrapper = mountTable();

    await wrapper.find('[data-testid="email-service-export-btn"]').trigger('click');
    await vi.waitFor(() => {
      expect(apiMocks.exportEmailServices).toHaveBeenCalledWith('csv');
    });

    const snackbar = wrapper.find('[data-testid="notice-snackbar"]');
    expect(snackbar.exists()).toBe(true);
    expect(snackbar.attributes('data-type')).toBe('success');
    expect(snackbar.attributes('data-message')).toContain('/tmp/export.csv');
  });

  it('shows a cancelled notice when the user cancels the save dialog', async () => {
    apiMocks.exportEmailServices.mockRejectedValue(
      new Error('Export cancelled by user')
    );
    const wrapper = mountTable();

    await wrapper.find('[data-testid="email-service-export-btn"]').trigger('click');
    await vi.waitFor(() => {
      const snackbar = wrapper.find('[data-testid="notice-snackbar"]');
      expect(snackbar.exists()).toBe(true);
      expect(snackbar.attributes('data-message')).toContain('Export cancelled');
    });
  });

  it('shows an error notice when the export fails for another reason', async () => {
    apiMocks.exportEmailServices.mockRejectedValue(new Error('disk full'));
    const wrapper = mountTable();

    await wrapper.find('[data-testid="email-service-export-btn"]').trigger('click');
    await vi.waitFor(() => {
      const snackbar = wrapper.find('[data-testid="notice-snackbar"]');
      expect(snackbar.exists()).toBe(true);
      expect(snackbar.attributes('data-message')).toContain('disk full');
    });
  });
});