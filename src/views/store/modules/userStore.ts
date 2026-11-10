import { ref } from "vue";
import { defineStore } from "pinia";
// Aliased so the action names (`login`, `getUserInfo`) don't shadow the API
// calls they delegate to. (The original Vuex class methods avoided the clash by
// living on `this`; a plain setup-store arrow function would recurse.)
import {
  login as loginRequest,
  Signout,
  getUserInfo as fetchUserInfo,
} from "@/views/api/users";
import { getToken, setToken, removeToken } from "@/views/utils/cookies";

/**
 * User store — Pinia (setup-style) port of the former Vuex
 * `vuex-module-decorators` `UserModule`.
 *
 * Auth behaviour preserved (WS-6 R6.1):
 *  - `login`          → validates via the login API and sets roles. NOTE: the
 *                       token is NOT persisted here (mirrors the original Vuex
 *                       action); `loginCallback` owns the token.
 *  - `loginCallback`  → persists the token (cookie) + state.
 *  - `getUserInfo`    → hydrates name/email; the router guard keys off these.
 *  - `resetToken`/`logout` → clears token + identity.
 *
 * The former permission route-generation (GenerateRoutes / router.addRoute on
 * the empty `asyncRoutes`) was removed as dead code (WS-6 R6.7): `asyncRoutes`
 * was empty and no consumer ever read `permission.routes`/`dynamicRoutes` (the
 * menu reads `router.options.routes` directly). The original threw on
 * `status === false`; that contract is preserved.
 */
export const useUserStore = defineStore("user", () => {
  const token = ref<string>(getToken() || "");
  const name = ref<string>("");
  const avatar = ref<string>("");
  const introduction = ref<string>("");
  const roles = ref<string[]>([]);
  const email = ref<string>("");

  const login = async (userInfo: {
    username: string;
    password: string;
  }): Promise<void> => {
    const username = userInfo.username.trim();
    const password = userInfo.password;
    const data = await loginRequest({ username, password });
    if (data.status === false) {
      throw Error(data.msg);
    }
    roles.value = data.data.roles;
  };

  const loginCallback = (data: {
    status: boolean;
    token?: string;
    msg?: string;
  }): void => {
    if (data.status === false) {
      throw Error(data.msg);
    }
    setToken(data.token!);
    token.value = data.token!;
  };

  const resetToken = (): void => {
    removeToken();
    token.value = "";
    roles.value = [];
    name.value = "";
    email.value = "";
    avatar.value = "";
    introduction.value = "";
  };

  const getUserInfo = async (): Promise<{
    name: string;
    email: string;
    [key: string]: unknown;
  }> => {
    const data = await fetchUserInfo();
    if (!data) {
      throw Error("Verification failed, please Login again.");
    }
    if (data.status === false) {
      throw Error(data.msg);
    }
    const { name: userName, email: userEmail } = data.data;
    name.value = userName;
    email.value = userEmail;
    return data.data;
  };

  const changeRoles = async (role: string): Promise<void> => {
    const newToken = role + "-token";
    token.value = newToken;
    setToken(newToken);
    await getUserInfo();
  };

  const logout = async (): Promise<void> => {
    if (token.value === "") {
      throw Error("LogOut: token is undefined!");
    }
    await Signout();
    removeToken();
    token.value = "";
    roles.value = [];
  };

  return {
    token,
    name,
    avatar,
    introduction,
    roles,
    email,
    login,
    loginCallback,
    resetToken,
    getUserInfo,
    changeRoles,
    logout,
  };
});
