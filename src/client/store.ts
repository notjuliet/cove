import { createContext, createSignal, useContext } from "solid-js";

import type { AuthUser, HealthResponse } from "../shared/types";
import { readRoute, routePath } from "./lib/routing";
import type { AdminTab, AppRoute, NoticeTone } from "./lib/types";
import { createAdminState } from "./state/admin";
import { createAuthActions } from "./state/auth";
import { createMediaState } from "./state/media";

const requestRefreshMs = 15_000;
const searchDebounceMs = 350;
const recentRequestLimit = 5;
const requestPageSize = 20;

function createAppState() {
  const [route, setRoute] = createSignal<AppRoute>(readRoute());
  const [health, setHealth] = createSignal<HealthResponse>();
  const [currentUser, setCurrentUser] = createSignal<AuthUser | null>(null);
  const [notice, setNoticeValue] = createSignal("");
  const [noticeTone, setNoticeTone] = createSignal<NoticeTone>("neutral");
  const [authBusy, setAuthBusy] = createSignal(false);
  const [setupBusy, setSetupBusy] = createSignal(false);

  function setNotice(message: string, tone: NoticeTone = "neutral") {
    setNoticeValue(message);
    setNoticeTone(tone);
  }

  function navigate(nextRoute: AppRoute, options: { replace?: boolean } = {}) {
    const nextPath = routePath(nextRoute);
    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (nextPath !== currentPath) {
      const method = options.replace ? "replaceState" : "pushState";
      window.history[method](null, "", nextPath);
    }
    setRoute(nextRoute);
  }

  function showHome() {
    navigate({ page: "home" });
    setNotice("");
  }

  function showRequestsRoute() {
    navigate({ page: "requests" });
  }

  function showAdminRoute() {
    navigate({ page: "admin", tab: "users" });
  }

  function showAdminTab(tab: AdminTab) {
    navigate({ page: "admin", tab });
  }

  const mediaState = createMediaState({
    currentUser,
    route,
    recentRequestLimit,
    requestPageSize,
    setNotice,
    navigate,
  });
  const adminState = createAdminState({
    currentUser,
    setCurrentUser,
    setNotice,
    loadRequests: mediaState.loadRequests,
  });
  const authActions = createAuthActions({
    setHealth,
    setCurrentUser,
    setAuthBusy,
    setSetupBusy,
    setNotice,
    navigate,
    clearAdminState: adminState.clearAdminState,
    loadRequests: mediaState.loadRequests,
    loadAdminSettings: adminState.loadAdminSettings,
  });

  return {
    route,
    health,
    currentUser,
    notice,
    noticeTone,
    authBusy,
    setupBusy,
    setRoute,
    setNotice,
    navigate,
    showHome,
    showRequestsRoute,
    showAdminRoute,
    showAdminTab,
    ...mediaState,
    ...authActions,
    ...adminState,
  };
}

export type Store = ReturnType<typeof createAppState>;

export const StoreContext = createContext<Store>();

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("useStore must be used within a StoreProvider");
  }
  return store;
}

export { createAppState, requestRefreshMs, searchDebounceMs, requestPageSize };
