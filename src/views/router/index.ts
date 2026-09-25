import { createRouter, createWebHashHistory } from "vue-router";
import { RouteRecordRaw } from "vue-router";
import AuthenticatedLayoutBoundary from "@/views/layout/AuthenticatedLayoutBoundary.vue";
import { authenticatedFeatureRoutes } from "@/views/router/authenticatedFeatureRoutes";

/**
 * Authenticated route topology (chat-first shell design §6):
 *
 * One route parent owns `AuthenticatedLayoutBoundary`, which mounts exactly
 * one authenticated shell for every authenticated leaf — the persistent
 * chat-first workspace shell (flag on) or the legacy layout (rollback).
 * All existing absolute URLs are preserved; only nesting changed.
 *
 * `/` resolves to the chat center (AI_Chat_Workspace) via the default child
 * redirect. Login, the auth handoff, and the catch-all stay OUTSIDE the
 * authenticated shell.
 */
export const constantRoutes: RouteRecordRaw[] = [
  {
    path: "/",
    component: AuthenticatedLayoutBoundary,
    meta: { requiresAuth: true },
    children: [
      {
        path: "",
        redirect: { name: "AI_Chat_Workspace" },
      },
      {
        // Chat center surface (design §8): a center route component, not a
        // second full-window shell.
        path: "aiworkspace",
        name: "AI_Chat_Workspace",
        meta: {
          visible: true,
          title: "route.ai_chat_workspace",
          icon: "mdi-chat-processing-outline",
          aiNavigable: true,
          aiAliases: [
            "chat workspace",
            "ai workspace",
            "workspace chat",
            "chat home",
            "full chat",
          ],
          aiDescription:
            "Open the AI chat workspace with workspaces, conversations, and the inspector",
        },
        component: () =>
          import("@/views/components/aiChatWorkspace/AiChatCenterSurface.vue"),
      },
      ...authenticatedFeatureRoutes,
    ],
  },
  {
    path: "/login",
    name: "login",
    meta: {
      title: "route.login",
      icon: "mdi-shield-account",
      visible: false,
      aiNavigable: false,
    },
    component: () => import("@/views/pages/login/login.vue"),
  },
  {
    path: "/:pathMatch(.*)",
    name: "Match",
    meta: { keepAlive: false },
    redirect: "/404",
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  scrollBehavior() {
    return { top: 0 };
  },
  routes: constantRoutes,
});

export default router;
