import { createApp } from "vue";
import { createPinia } from "pinia";
import "./styles/index.scss";
import App from "./App.vue";
import router from "./router";
import { vuetify } from "./plugins/vuetify";
import { loadFonts } from "./plugins/webfontloader";
import "./permission";
// import { createI18n } from 'vue-i18n'
import i18n from "./lang";
import { reportRendererError } from "@/views/api/diagnostics";

loadFonts();
// const i18n = createI18n({
//   // something vue-i18n options here ...
// })

/**
 * Convert a global `error` / `unhandledrejection` event into the payload shape
 * expected by `diagnostics:renderer-error`. Defensive: never throws — if
 * normalization fails, we still report a minimal message.
 */
function toRendererErrorPayload(event: ErrorEvent | PromiseRejectionEvent): {
  message: string;
  stack?: string;
  feature?: string;
  level?: "warn" | "error";
  fatal?: boolean;
} {
  if (event instanceof ErrorEvent) {
    const err = event.error ?? new Error(event.message);
    const message =
      (err &&
        typeof err === "object" &&
        "message" in err &&
        String((err as Error).message)) ||
      event.message ||
      "renderer error";
    const stack =
      (err &&
        typeof err === "object" &&
        "stack" in err &&
        String((err as Error).stack)) ||
      undefined;
    return {
      message,
      stack: stack?.slice(0, 16 * 1024),
      feature: "renderer",
      fatal: false,
    };
  }
  // PromiseRejectionEvent
  const reason = (event as PromiseRejectionEvent).reason;
  const err: Error =
    reason instanceof Error ? reason : new Error(String(reason));
  return {
    message: err.message,
    stack: err.stack?.slice(0, 16 * 1024),
    feature: "renderer",
    level: "error",
  };
}

// Report uncaught renderer errors and unhandled promise rejections to the main
// process so they are persisted alongside native crashes and breadcrumbs.
// Fire-and-forget; never let the reporter itself throw synchronously.
window.addEventListener("error", (e: ErrorEvent) => {
  try {
    void reportRendererError(toRendererErrorPayload(e));
  } catch {
    /* swallow — never let error reporting trigger more errors */
  }
});
window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
  try {
    void reportRendererError(toRendererErrorPayload(e));
  } catch {
    /* swallow */
  }
});

createApp(App)
  .use(createPinia())
  .use(vuetify)
  .use(router)
  .use(i18n)
  .mount("#app")
  .$nextTick(() => {
    const d = document.getElementById("_loading_");
    d?.setAttribute("class", "la-ball-climbing-dot hide");
  });
