import { createSignal, type Accessor, type Setter } from "solid-js";

import type {
  AdminIntegrationSettings,
  AdminUser,
  ArrServiceOptions,
  AuthUser,
} from "../../shared/types";
import { api, messageFor } from "../lib/api";
import type {
  AdminSettingsInput,
  ArrOptionsBusyState,
  ArrOptionsErrorState,
  ArrOptionsState,
  ArrServiceName,
  ConnectionInput,
  NoticeTone,
} from "../lib/types";

type AdminStateInput = {
  currentUser: Accessor<AuthUser | null>;
  setCurrentUser: Setter<AuthUser | null>;
  setNotice: (message: string, tone?: NoticeTone) => void;
  loadRequests: () => Promise<void>;
};

export function createAdminState({
  currentUser,
  setCurrentUser,
  setNotice,
  loadRequests,
}: AdminStateInput) {
  const [settingsBusy, setSettingsBusy] = createSignal(false);
  const [usersBusy, setUsersBusy] = createSignal(false);
  const [syncUsersBusy, setSyncUsersBusy] = createSignal(false);
  const [syncBusy, setSyncBusy] = createSignal(false);
  const [adminSettings, setAdminSettings] = createSignal<AdminIntegrationSettings>();
  const [adminUsers, setAdminUsers] = createSignal<AdminUser[]>([]);
  const [adminUsersLoaded, setAdminUsersLoaded] = createSignal(false);
  const [arrOptions, setArrOptions] = createSignal<ArrOptionsState>({});
  const [arrOptionsBusy, setArrOptionsBusy] = createSignal<ArrOptionsBusyState>({});
  const [arrOptionsError, setArrOptionsError] = createSignal<ArrOptionsErrorState>({});
  const arrOptionsLoadTokens: Record<ArrServiceName, number> = { radarr: 0, sonarr: 0 };

  function clearAdminState() {
    setAdminSettings(undefined);
    setAdminUsers([]);
    setAdminUsersLoaded(false);
    setArrOptions({});
    setArrOptionsBusy({});
    setArrOptionsError({});
  }

  async function loadAdminSettings() {
    if (!currentUser()?.isAdministrator) {
      return;
    }

    setSettingsBusy(true);
    setNotice("");

    try {
      const data = await api<{ settings: AdminIntegrationSettings }>("/api/admin/settings");
      setAdminSettings(data.settings);
    } catch (error) {
      setNotice(messageFor(error), "error");
    } finally {
      setSettingsBusy(false);
    }
  }

  function clearArrOptions(service: ArrServiceName) {
    arrOptionsLoadTokens[service]++;
    setArrOptions((current) => ({ ...current, [service]: undefined }));
    setArrOptionsBusy((current) => ({ ...current, [service]: false }));
    setArrOptionsError((current) => ({ ...current, [service]: false }));
  }

  async function loadArrOptions(service: ArrServiceName, input: ConnectionInput = {}) {
    const token = ++arrOptionsLoadTokens[service];
    setArrOptionsBusy((current) => ({ ...current, [service]: true }));
    setArrOptionsError((current) => ({ ...current, [service]: false }));

    try {
      const data = await api<{ options: ArrServiceOptions }>(`/api/admin/${service}/options`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (token === arrOptionsLoadTokens[service]) {
        setArrOptions((current) => ({ ...current, [service]: data.options }));
        setArrOptionsError((current) => ({ ...current, [service]: false }));
      }
    } catch {
      if (token === arrOptionsLoadTokens[service]) {
        setArrOptions((current) => ({ ...current, [service]: undefined }));
        setArrOptionsError((current) => ({ ...current, [service]: true }));
      }
    } finally {
      if (token === arrOptionsLoadTokens[service]) {
        setArrOptionsBusy((current) => ({ ...current, [service]: false }));
      }
    }
  }

  async function syncJellyfinAvailability() {
    setSyncBusy(true);
    setNotice("");

    try {
      const data = await api<{ result: { availableCount: number } }>("/api/admin/jellyfin/sync", {
        method: "POST",
      });
      await loadRequests();
      setNotice(`Scanned ${data.result.availableCount} Jellyfin titles.`);
    } catch (error) {
      setNotice(messageFor(error), "error");
    } finally {
      setSyncBusy(false);
    }
  }

  async function saveAdminSettings(input: AdminSettingsInput) {
    setSettingsBusy(true);
    setNotice("");

    try {
      const data = await api<{ settings: AdminIntegrationSettings }>("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(input),
      });
      setAdminSettings(data.settings);
      setNotice("Settings saved.");
    } catch (error) {
      setNotice(messageFor(error), "error");
      throw error;
    } finally {
      setSettingsBusy(false);
    }
  }

  async function loadAdminUsers() {
    if (!currentUser()?.isAdministrator) {
      return;
    }

    setUsersBusy(true);
    setNotice("");

    try {
      const data = await api<{ users: AdminUser[] }>("/api/admin/users");
      setAdminUsers(data.users);
      refreshCurrentUserFromAdminUsers(data.users);
      setAdminUsersLoaded(true);
    } catch (error) {
      setNotice(messageFor(error), "error");
    } finally {
      setUsersBusy(false);
    }
  }

  async function syncJellyfinUsers() {
    setSyncUsersBusy(true);
    setNotice("");

    try {
      const data = await api<{ users: AdminUser[]; syncedCount: number; removedCount: number }>(
        "/api/admin/users/sync",
        { method: "POST" },
      );
      setAdminUsers(data.users);
      refreshCurrentUserFromAdminUsers(data.users);
      setAdminUsersLoaded(true);
      await loadRequests();
      setNotice(
        data.removedCount > 0
          ? `Synced ${data.syncedCount} Jellyfin users and removed ${data.removedCount} local ${data.removedCount === 1 ? "user" : "users"}.`
          : `Synced ${data.syncedCount} Jellyfin users.`,
      );
    } catch (error) {
      setNotice(messageFor(error), "error");
    } finally {
      setSyncUsersBusy(false);
    }
  }

  function refreshCurrentUserFromAdminUsers(users: AdminUser[]) {
    const user = currentUser();
    const refreshed = user ? users.find((candidate) => candidate.id === user.id) : undefined;
    if (!refreshed) {
      return;
    }

    setCurrentUser({
      id: refreshed.id,
      jellyfinUserId: refreshed.jellyfinUserId,
      name: refreshed.name,
      isAdministrator: refreshed.isAdministrator,
    });
  }

  return {
    settingsBusy,
    usersBusy,
    syncUsersBusy,
    syncBusy,
    adminSettings,
    adminUsers,
    adminUsersLoaded,
    arrOptions,
    arrOptionsBusy,
    arrOptionsError,
    clearAdminState,
    loadAdminSettings,
    clearArrOptions,
    loadArrOptions,
    syncJellyfinAvailability,
    saveAdminSettings,
    loadAdminUsers,
    syncJellyfinUsers,
  };
}
