import { Match, Show, Switch, createEffect, onCleanup, onMount } from "solid-js";

import { AuthPanel } from "./components/AuthPanel";
import { RequestModal } from "./components/RequestModal";
import { mediaKey } from "./lib/media";
import { readRoute } from "./lib/routing";
import { controlClass } from "./lib/ui";
import { AdminPage } from "./pages/AdminPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { RequestsPage } from "./pages/RequestsPage";
import { SearchPage } from "./pages/SearchPage";
import { SetupPage } from "./pages/SetupPage";
import {
  StoreContext,
  createAppState,
  requestRefreshMs,
  searchDebounceMs,
  useStore,
} from "./store";

export default function App() {
  return (
    <StoreContext.Provider value={createAppState()}>
      <AppShell />
    </StoreContext.Provider>
  );
}

function AppShell() {
  const store = useStore();
  const noticeToneClass = () =>
    store.noticeTone() === "error"
      ? "border-(--color-danger-border) bg-(--color-danger-soft) text-(--color-danger)"
      : "border-(--color-border) bg-(--color-surface-soft) text-(--color-text)";

  onMount(() => {
    const handlePopState = () => store.setRoute(readRoute());
    window.addEventListener("popstate", handlePopState);
    onCleanup(() => window.removeEventListener("popstate", handlePopState));
    store.maybeBoot();
  });

  createEffect(() => {
    const currentRoute = store.route();
    const currentHealth = store.health();

    if (!currentHealth || currentHealth.setupRequired) {
      return;
    }

    if (currentRoute.page === "home") {
      store.clearSearchState();
      return;
    }

    if (currentRoute.page === "admin") {
      store.clearSearchState();

      const user = store.currentUser();
      if (user && !user.isAdministrator) {
        store.navigate({ page: "home" }, { replace: true });
        return;
      }

      if (
        currentRoute.tab === "settings" &&
        user?.isAdministrator &&
        !store.adminSettings() &&
        !store.settingsBusy()
      ) {
        void store.loadAdminSettings();
      }

      if (
        currentRoute.tab === "users" &&
        user?.isAdministrator &&
        !store.adminUsersLoaded() &&
        !store.usersBusy()
      ) {
        void store.loadAdminUsers();
      }
      return;
    }

    if (currentRoute.page === "requests") {
      store.clearSearchState();

      const user = store.currentUser();
      if (user?.isAdministrator && !store.adminUsersLoaded() && !store.usersBusy()) {
        void store.loadAdminUsers();
      }
      return;
    }

    store.loadSearchRoute(currentRoute.query);
  });

  createEffect(() => {
    const searchQuery = store.query().trim();
    const currentRoute = store.route();

    if (currentRoute.page === "admin" || currentRoute.page === "requests") {
      return;
    }

    if (!searchQuery) {
      if (currentRoute.page === "search") {
        store.cancelSearchLoad();
        store.navigate({ page: "home" }, { replace: true });
      }
      return;
    }

    if (currentRoute.page === "search" && currentRoute.query === searchQuery) {
      store.resumeSearchRoute(currentRoute.query);
      return;
    }

    store.cancelSearchLoad({ showBusy: currentRoute.page === "search" });
    const user = store.currentUser();
    const timeout = window.setTimeout(() => {
      if (!user) {
        store.setNotice("Sign in with Jellyfin before searching.", "error");
        return;
      }

      store.navigate({ page: "search", query: searchQuery });
    }, searchDebounceMs);

    onCleanup(() => window.clearTimeout(timeout));
  });

  createEffect(() => {
    const user = store.currentUser();
    if (!user) {
      return;
    }

    let refreshing = false;
    const refresh = () => {
      if (refreshing || document.hidden) {
        return;
      }

      refreshing = true;
      void store
        .loadRequests()
        .catch(() => {
          // Background refresh should never interrupt the active flow.
        })
        .finally(() => {
          refreshing = false;
        });
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) {
        refresh();
      }
    };

    const interval = window.setInterval(refresh, requestRefreshMs);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    onCleanup(() => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    });
  });

  createEffect(() => {
    if (!store.notice()) {
      return;
    }

    const timeout = window.setTimeout(() => store.setNotice(""), 4000);
    onCleanup(() => window.clearTimeout(timeout));
  });

  return (
    <>
      <Show when={store.notice()}>
        <div
          role={store.noticeTone() === "error" ? "alert" : "status"}
          aria-live={store.noticeTone() === "error" ? "assertive" : "polite"}
          class="notice-toast fixed top-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md"
        >
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => store.setNotice("")}
            class={`w-full rounded-xl border px-4 py-3 text-left text-sm font-semibold shadow-(--shadow-soft) ${noticeToneClass()}`}
          >
            {store.notice()}
          </button>
        </div>
      </Show>

      <Show
        when={store.health()}
        fallback={
          <div class="grid min-h-screen place-items-center bg-(--color-bg) p-6 text-sm text-(--color-muted)">
            Loading...
          </div>
        }
      >
        {(loadedHealth) => (
          <Show
            when={!loadedHealth().setupRequired}
            fallback={<SetupPage busy={store.setupBusy()} onSetup={store.completeFirstRunSetup} />}
          >
            <Show
              when={store.currentUser()}
              fallback={<LoginPage busy={store.authBusy()} onLogin={store.loginJellyfin} />}
            >
              {(user) => (
                <div class="min-h-screen bg-(--color-bg) text-(--color-text)">
                  <header class="mx-auto w-full max-w-3xl px-5 pt-5">
                    <div class="rounded-2xl border border-(--color-border) bg-(--color-surface) p-3 shadow-(--shadow-card)">
                      <div class="flex items-center justify-between gap-4 px-1">
                        <a
                          href="/"
                          onClick={(event) => {
                            event.preventDefault();
                            store.showHome();
                          }}
                          class="flex items-center gap-2 rounded-lg border-0 bg-transparent p-0 text-left text-(--color-text)"
                        >
                          <img src="/logo.svg" alt="" class="h-8 w-8 rounded-lg" />
                          <h1 class="m-0 text-xl font-bold tracking-normal">Cove</h1>
                        </a>

                        <AuthPanel
                          user={user()}
                          busy={store.authBusy()}
                          canManageAdmin={user().isAdministrator}
                          onLogout={store.logout}
                          onRequests={store.showRequestsRoute}
                          onAdmin={store.showAdminRoute}
                        />
                      </div>

                      <Show
                        when={store.route().page !== "admin" && store.route().page !== "requests"}
                      >
                        <form class="mt-3" onSubmit={store.runSearch}>
                          <input
                            id="media-search"
                            aria-label="Search movies and shows"
                            value={store.query()}
                            onInput={(event) => store.setQuery(event.currentTarget.value)}
                            placeholder="Search movies and shows"
                            autocomplete="off"
                            class={`${controlClass} h-13 rounded-xl px-4 text-base`}
                          />
                        </form>
                      </Show>
                    </div>
                  </header>

                  <Show when={store.route().page === "admin" && user().isAdministrator}>
                    <AdminPage />
                  </Show>

                  <Show when={store.route().page !== "admin" || !user().isAdministrator}>
                    <main class="mx-auto grid w-full max-w-3xl gap-5 px-5 pt-5 pb-10 sm:pb-14">
                      <Switch fallback={<HomePage />}>
                        <Match when={store.route().page === "requests"}>
                          <RequestsPage />
                        </Match>
                        <Match when={store.route().page === "search"}>
                          <SearchPage />
                        </Match>
                      </Switch>
                    </main>
                  </Show>

                  <Show when={store.requestModalItem()}>
                    {(item) => (
                      <RequestModal
                        item={item()}
                        selectedSeasonNumbers={store.selectedSeasonNumbers()}
                        busy={store.busyKey() === mediaKey(item())}
                        error={store.requestModalError()}
                        onToggle={store.toggleSeason}
                        onCancel={store.closeRequestModal}
                        onSubmit={store.submitRequest}
                      />
                    )}
                  </Show>
                </div>
              )}
            </Show>
          </Show>
        )}
      </Show>
    </>
  );
}
