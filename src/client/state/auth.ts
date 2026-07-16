import type { Setter } from "solid-js";

import type { AuthUser, HealthResponse } from "../../shared/types";
import { api, messageFor } from "../lib/api";
import type { AppRoute, FirstRunSetupInput, NoticeTone, SetupResponse } from "../lib/types";

type AuthActionsInput = {
  setHealth: Setter<HealthResponse | undefined>;
  setCurrentUser: Setter<AuthUser | null>;
  setAuthBusy: Setter<boolean>;
  setSetupBusy: Setter<boolean>;
  setNotice: (message: string, tone?: NoticeTone) => void;
  navigate: (nextRoute: AppRoute, options?: { replace?: boolean }) => void;
  clearAdminState: () => void;
  loadRequests: () => Promise<void>;
  loadAdminSettings: () => Promise<void>;
};

export function createAuthActions({
  setHealth,
  setCurrentUser,
  setAuthBusy,
  setSetupBusy,
  setNotice,
  navigate,
  clearAdminState,
  loadRequests,
  loadAdminSettings,
}: AuthActionsInput) {
  let booted = false;

  async function boot() {
    try {
      const nextHealth = await api<HealthResponse>("/api/health");
      if (nextHealth.setupRequired) {
        setHealth(nextHealth);
        return;
      }

      let user: AuthUser | null = null;
      try {
        const data = await api<{ user: AuthUser | null }>("/api/auth/me");
        user = data.user;
        setCurrentUser(user);
      } finally {
        setHealth(nextHealth);
      }

      if (user) {
        await loadRequests();
      }
    } catch (error) {
      setNotice(messageFor(error), "error");
    }
  }

  function maybeBoot() {
    if (!booted) {
      booted = true;
      void boot();
    }
  }

  async function loginJellyfin(username: string, password: string) {
    setAuthBusy(true);
    setNotice("");

    try {
      const data = await api<{ user: AuthUser }>("/api/auth/jellyfin", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setCurrentUser(data.user);
      if (!data.user.isAdministrator) {
        clearAdminState();
      }
      await loadRequests();
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    setAuthBusy(true);
    setNotice("");

    try {
      await api("/api/auth/logout", {
        method: "POST",
      });
      setCurrentUser(null);
      clearAdminState();
      navigate({ page: "home" }, { replace: true });
      await loadRequests();
    } catch (error) {
      setNotice(messageFor(error), "error");
    } finally {
      setAuthBusy(false);
    }
  }

  async function completeFirstRunSetup(input: FirstRunSetupInput) {
    setSetupBusy(true);
    setNotice("");

    try {
      const data = await api<SetupResponse>("/api/setup", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setHealth({ ok: true, setupRequired: data.settings.setupRequired });
      setCurrentUser(data.user);
      navigate({ page: "admin", tab: "settings" }, { replace: true });
      await Promise.all([loadRequests(), loadAdminSettings()]);
    } catch (error) {
      setNotice(messageFor(error), "error");
      throw error;
    } finally {
      setSetupBusy(false);
    }
  }

  return {
    maybeBoot,
    loginJellyfin,
    logout,
    completeFirstRunSetup,
  };
}
