import { beforeEach, describe, expect, it } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import {
  enqueueRoutePush,
  resetRoutePushQueueForTests,
  type RoutePushTarget,
} from "@/views/utils/enqueueRoutePush";

function dummyView(): ReturnType<typeof h> {
  return h("div");
}

/** The queue chains through Promise callbacks, so the first push starts later. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function chatAndPluginsRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        name: "AI_Chat_Workspace",
        component: { render: dummyView },
      },
      {
        path: "/plugins/management",
        name: "Plugins",
        component: { render: dummyView },
      },
    ],
  });
}

describe("enqueueRoutePush", () => {
  beforeEach(() => {
    resetRoutePushQueueForTests();
  });

  it("runs a later push only after an in-flight push settles", async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const router: RoutePushTarget = {
      push(location): Promise<unknown> {
        const label =
          typeof location === "string" ? location : JSON.stringify(location);
        order.push(`start:${label}`);
        if (location === "/plugins/management") {
          return first.then(() => {
            order.push(`end:${label}`);
          });
        }
        order.push(`end:${label}`);
        return Promise.resolve();
      },
    };

    const plugins = enqueueRoutePush(router, "/plugins/management");
    const chat = enqueueRoutePush(router, { name: "AI_Chat_Workspace" });
    await nextTurn();
    expect(order).toEqual(["start:/plugins/management"]);

    releaseFirst();
    await Promise.all([plugins, chat]);
    expect(order).toEqual([
      "start:/plugins/management",
      "end:/plugins/management",
      'start:{"name":"AI_Chat_Workspace"}',
      'end:{"name":"AI_Chat_Workspace"}',
    ]);
  });

  it("keeps the latest click when an earlier lazy navigation is still pending", async () => {
    let releasePlugins: () => void = () => undefined;
    const router = chatAndPluginsRouter();
    router.beforeEach((to) => {
      if (to.path !== "/plugins/management") return true;
      return new Promise<boolean>((resolve) => {
        releasePlugins = () => resolve(true);
      });
    });
    await router.push("/");
    await router.isReady();

    const plugins = enqueueRoutePush(router, "/plugins/management");
    const chat = enqueueRoutePush(router, { name: "AI_Chat_Workspace" });
    await nextTurn();
    expect(router.currentRoute.value.name).toBe("AI_Chat_Workspace");

    releasePlugins();
    await Promise.all([plugins, chat]);
    expect(router.currentRoute.value.name).toBe("AI_Chat_Workspace");
  });

  it("swallows a duplicate push and still accepts the next one", async () => {
    const router = chatAndPluginsRouter();
    await router.push("/");
    await router.isReady();
    await enqueueRoutePush(router, { name: "AI_Chat_Workspace" });
    await enqueueRoutePush(router, "/plugins/management");
    expect(router.currentRoute.value.name).toBe("Plugins");
  });

  it("propagates non-navigation errors and still runs the next push", async () => {
    let calls = 0;
    const router: RoutePushTarget = {
      push(): Promise<unknown> {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("boom"));
        return Promise.resolve();
      },
    };

    await expect(enqueueRoutePush(router, "/plugins/management")).rejects.toThrow(
      "boom"
    );
    await enqueueRoutePush(router, { name: "AI_Chat_Workspace" });
    expect(calls).toBe(2);
  });
});
