import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import DashboardSummaryCards from "@/views/dashboard/components/DashboardSummaryCards.vue";
import type { DashboardSummary } from "@/entityTypes/dashboardType";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const baseSummary: DashboardSummary = {
  searchResults: {
    total: 10,
    periodCount: 4,
    trend: 25.4,
    trendDirection: "up",
  },
  emailsExtracted: {
    total: 20,
    periodCount: 6,
    trend: -12.3,
    trendDirection: "down",
  },
  emailsSent: {
    total: 30,
    periodCount: 8,
    trend: 0,
    trendDirection: "neutral",
    successRate: 92.5,
    successCount: 7,
    failedCount: 1,
  },
};

const stubs = {
  VRow: { template: "<div><slot /></div>" },
  VCol: { template: "<div class='v-col'><slot /></div>" },
  VCard: { template: "<div class='v-card'><slot /></div>" },
  VCardText: { template: "<div><slot /></div>" },
  VIcon: { template: "<i><slot /></i>" },
  VSkeletonLoader: { template: "<div>skeleton</div>" },
};

function makeWrapper(data: DashboardSummary | null, loading = false) {
  return mount(DashboardSummaryCards, {
    props: { data, loading },
    global: { stubs },
  });
}

describe("DashboardSummaryCards (yellow pages removal)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders exactly three summary cards after yellow-pages removal", () => {
    const wrapper = makeWrapper(baseSummary);
    const cards = wrapper.findAll(".v-card");
    expect(cards.length).toBe(3);
  });

  it("never renders the yellow pages card or its labels", () => {
    const wrapper = makeWrapper(baseSummary);
    const text = wrapper.text();
    expect(text).not.toContain("home.yellow_pages");
    expect(text).not.toContain("yellow");
    expect(text).not.toContain("Yellow");
    expect(text).not.toContain("yellowPagesResults");
  });

  it("renders the three surviving cards with their counts and trends", () => {
    const wrapper = makeWrapper(baseSummary);
    const text = wrapper.text();
    expect(text).toContain("home.search_results");
    expect(text).toContain("home.emails_extracted");
    expect(text).toContain("home.emails_sent");
    expect(text).toContain((baseSummary.searchResults.periodCount ?? 0).toLocaleString());
    expect(text).toContain((baseSummary.emailsExtracted.periodCount ?? 0).toLocaleString());
    expect(text).toContain((baseSummary.emailsSent.periodCount ?? 0).toLocaleString());
  });

  it("still renders skeletons for all surviving cards while loading", () => {
    const wrapper = makeWrapper(baseSummary, true);
    const skeletons = wrapper.findAll(".v-card");
    expect(skeletons.length).toBe(3);
    expect(wrapper.text()).toContain("skeleton");
  });

  it("emits card-clicked with the surviving metric keys; yellowpages never emitted", async () => {
    const wrapper = makeWrapper(baseSummary);
    const cards = wrapper.findAll(".v-card");
    const emitted: string[] = [];
    await cards[0].trigger("click");
    await cards[1].trigger("click");
    await cards[2].trigger("click");
    const events = wrapper.emitted("card-clicked") ?? [];
    for (const ev of events) {
      const key = ev[0] as string;
      emitted.push(key);
      expect(key).not.toBe("yellowpages");
    }
    expect(emitted).toEqual(["search", "emails", "emailssent"]);
  });

  it("renders zero values when data is null", () => {
    const wrapper = makeWrapper(null);
    expect(wrapper.text()).toContain("0");
    expect(wrapper.findAll(".v-card").length).toBe(3);
  });
});
