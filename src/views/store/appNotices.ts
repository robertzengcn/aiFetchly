import { ref } from "vue";
import { defineStore } from "pinia";
import type { AppNotice } from "@/views/types/uiConvergenceTypes";

const MAX_NOTICES = 5;

let noticeCounter = 0;
function nextNoticeId(): string {
  noticeCounter += 1;
  return `notice-${noticeCounter}`;
}

/**
 * Bounded global notice queue (design §20.1). Notices carry translation keys
 * and action IDS — never closures, raw errors, or payload bodies.
 */
export const useAppNoticesStore = defineStore("appNotices", () => {
  const notices = ref<readonly AppNotice[]>([]);

  function push(notice: Omit<AppNotice, "id"> & { id?: string }): string {
    const id = notice.id ?? nextNoticeId();
    const full: AppNotice = { ...notice, id };
    notices.value = [...notices.value.slice(-(MAX_NOTICES - 1)), full];
    return id;
  }

  function dismiss(id: string): void {
    notices.value = notices.value.filter((n) => n.id !== id);
  }

  return { notices, push, dismiss };
});
