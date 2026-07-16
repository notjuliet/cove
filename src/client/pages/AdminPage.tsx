import { For, Show } from "solid-js";

import { routePath } from "../lib/routing";
import type { AdminTab } from "../lib/types";
import { useStore } from "../store";
import { SettingsPage } from "./SettingsPage";
import { UsersPage } from "./UsersPage";

const adminTabs = [
  { id: "users", label: "Users" },
  { id: "settings", label: "Settings" },
] as const;

const adminActionClass =
  "inline-flex h-8 items-center justify-center rounded-md bg-(--color-button) px-3 text-xs font-semibold text-(--color-button-text) transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60";

export function AdminPage() {
  const store = useStore();
  const activeTab = (): AdminTab => {
    const currentRoute = store.route();
    return currentRoute.page === "admin" ? currentRoute.tab : "users";
  };

  return (
    <main class="mx-auto w-full max-w-3xl px-5 pt-5 pb-10 sm:pb-14">
      <section class="overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-surface) shadow-(--shadow-card)">
        <div class="flex items-center justify-between gap-3 px-4 py-3">
          <nav
            aria-label="Admin sections"
            class="flex w-fit gap-1 rounded-lg bg-(--color-surface-soft) p-1"
          >
            <For each={adminTabs}>
              {(tab) => {
                const selected = () => activeTab() === tab.id;

                return (
                  <a
                    href={routePath({ page: "admin", tab: tab.id })}
                    aria-current={selected() ? "page" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      store.showAdminTab(tab.id);
                    }}
                    class={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      selected()
                        ? "bg-(--color-surface) text-(--color-text) shadow-sm"
                        : "text-(--color-muted) hover:text-(--color-text)"
                    }`}
                  >
                    {tab.label}
                  </a>
                );
              }}
            </For>
          </nav>

          <Show when={activeTab() === "users"}>
            <button
              type="button"
              onClick={() => void store.syncJellyfinUsers()}
              disabled={store.usersBusy() || store.syncUsersBusy()}
              class={adminActionClass}
            >
              {store.syncUsersBusy() ? "Syncing..." : "Sync Users"}
            </button>
          </Show>

          <Show when={activeTab() === "settings"}>
            <button
              type="submit"
              form="admin-settings-form"
              disabled={store.settingsBusy() || !store.adminSettings()}
              class={adminActionClass}
            >
              {!store.adminSettings()
                ? "Loading..."
                : store.settingsBusy()
                  ? "Saving..."
                  : "Save settings"}
            </button>
          </Show>
        </div>

        <div class="border-t border-(--color-border) p-4 sm:p-5">
          <Show when={activeTab() === "settings"}>
            <SettingsPage />
          </Show>

          <Show when={activeTab() === "users"}>
            <UsersPage />
          </Show>
        </div>
      </section>
    </main>
  );
}
