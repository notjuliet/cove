import { createContext, createSignal, useContext } from "solid-js";

import type {
  AdminIntegrationSettings,
  AdminUser,
  AuthUser,
  HealthResponse,
  MediaRequest,
  TmdbMedia,
} from "../shared/types";
import { readRoute, routePath } from "./lib/routing";
import type {
  AdminTab,
  AppRoute,
  ArrOptionsBusyState,
  ArrOptionsErrorState,
  ArrOptionsState,
  ArrServiceName,
  NoticeTone,
} from "./lib/types";
import { createAdminActions } from "./state/admin";
import { createAuthActions } from "./state/auth";
import { createMediaActions } from "./state/media";

const requestRefreshMs = 15_000;
const searchDebounceMs = 350;
const recentRequestLimit = 5;
const requestPageSize = 20;

function createAppState() {
  const [route, setRoute] = createSignal<AppRoute>(readRoute());
  const [health, setHealth] = createSignal<HealthResponse>();
  const [currentUser, setCurrentUser] = createSignal<AuthUser | null>(null);
  const [recentRequests, setRecentRequests] = createSignal<MediaRequest[]>([]);
  const [requests, setRequests] = createSignal<MediaRequest[]>([]);
  const [requestTotal, setRequestTotal] = createSignal(0);
  const [requestPage, setRequestPage] = createSignal(1);
  const [requestUserFilter, setRequestUserFilter] = createSignal<number>();
  const [requestsBusy, setRequestsBusy] = createSignal(false);
  const [requestsLoaded, setRequestsLoaded] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<TmdbMedia[]>([]);
  const [searchBusy, setSearchBusy] = createSignal(false);
  const [requestModalItem, setRequestModalItem] = createSignal<TmdbMedia>();
  const [selectedSeasonNumbers, setSelectedSeasonNumbers] = createSignal<number[]>([]);
  const [requestModalError, setRequestModalError] = createSignal("");
  const [notice, setNoticeValue] = createSignal("");
  const [noticeTone, setNoticeTone] = createSignal<NoticeTone>("neutral");
  const [busyKey, setBusyKey] = createSignal("");
  const [authBusy, setAuthBusy] = createSignal(false);
  const [settingsBusy, setSettingsBusy] = createSignal(false);
  const [usersBusy, setUsersBusy] = createSignal(false);
  const [syncUsersBusy, setSyncUsersBusy] = createSignal(false);
  const [setupBusy, setSetupBusy] = createSignal(false);
  const [syncBusy, setSyncBusy] = createSignal(false);
  const [adminSettings, setAdminSettings] = createSignal<AdminIntegrationSettings>();
  const [adminUsers, setAdminUsers] = createSignal<AdminUser[]>([]);
  const [adminUsersLoaded, setAdminUsersLoaded] = createSignal(false);
  const [arrOptions, setArrOptions] = createSignal<ArrOptionsState>({});
  const [arrOptionsBusy, setArrOptionsBusy] = createSignal<ArrOptionsBusyState>({});
  const [arrOptionsError, setArrOptionsError] = createSignal<ArrOptionsErrorState>({});
  const arrOptionsLoadTokens: Record<ArrServiceName, number> = {
    radarr: 0,
    sonarr: 0,
  };

  function setNotice(message: string, tone: NoticeTone = "neutral") {
    setNoticeValue(message);
    setNoticeTone(tone);
  }

  function clearAdminState() {
    setAdminSettings(undefined);
    setAdminUsers([]);
    setAdminUsersLoaded(false);
    setArrOptions({});
    setArrOptionsBusy({});
    setArrOptionsError({});
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

  const mediaActions = createMediaActions({
    currentUser,
    route,
    setRecentRequests,
    setRequests,
    setRequestTotal,
    requestPage,
    setRequestPage,
    requestUserFilter,
    setRequestUserFilter,
    setRequestsBusy,
    setRequestsLoaded,
    recentRequestLimit,
    requestPageSize,
    query,
    setQuery,
    setResults,
    setSearchBusy,
    requestModalItem,
    setRequestModalItem,
    selectedSeasonNumbers,
    setSelectedSeasonNumbers,
    setRequestModalError,
    setNotice,
    setBusyKey,
    navigate,
  });
  const adminActions = createAdminActions({
    currentUser,
    setCurrentUser,
    setAdminSettings,
    setAdminUsers,
    setAdminUsersLoaded,
    setArrOptions,
    setArrOptionsBusy,
    setArrOptionsError,
    setSettingsBusy,
    setUsersBusy,
    setSyncUsersBusy,
    setSyncBusy,
    setNotice,
    arrOptionsLoadTokens,
    loadRequests: mediaActions.loadRequests,
  });
  const authActions = createAuthActions({
    setHealth,
    setCurrentUser,
    setAuthBusy,
    setSetupBusy,
    setNotice,
    navigate,
    clearAdminState,
    loadRequests: mediaActions.loadRequests,
    loadAdminSettings: adminActions.loadAdminSettings,
  });

  return {
    route,
    health,
    currentUser,
    recentRequests,
    requests,
    requestTotal,
    requestPage,
    requestUserFilter,
    requestsBusy,
    requestsLoaded,
    query,
    results,
    searchBusy,
    requestModalItem,
    selectedSeasonNumbers,
    requestModalError,
    notice,
    noticeTone,
    busyKey,
    authBusy,
    settingsBusy,
    usersBusy,
    syncUsersBusy,
    setupBusy,
    syncBusy,
    adminSettings,
    adminUsers,
    adminUsersLoaded,
    arrOptions,
    arrOptionsBusy,
    arrOptionsError,
    setRoute,
    setQuery,
    setNotice,
    navigate,
    showHome,
    showRequestsRoute,
    showAdminRoute,
    showAdminTab,
    ...mediaActions,
    ...authActions,
    ...adminActions,
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
