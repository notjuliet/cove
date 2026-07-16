import { For, Show, onMount } from "solid-js";

import { RequestItem } from "../components/RequestItem";
import { smallSecondaryButtonClass } from "../lib/ui";
import { requestPageSize, useStore } from "../store";

export function RequestsPage() {
  const store = useStore();
  const isAdmin = () => Boolean(store.currentUser()?.isAdministrator);
  const pageCount = () => Math.max(1, Math.ceil(store.requestTotal() / requestPageSize));

  onMount(() => void store.loadRequestPage());

  return (
    <section class="overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-surface) shadow-(--shadow-card)">
      <div class="flex items-center justify-between gap-3 px-4 py-3">
        <h2 class="m-0 text-xl font-bold tracking-normal">Requests</h2>
        <Show when={isAdmin()}>
          <label>
            <span class="sr-only">Filter requests by user</span>
            <select
              value={store.requestUserFilter() ?? ""}
              onInput={(event) =>
                void store.filterRequestsByUser(
                  event.currentTarget.value ? Number(event.currentTarget.value) : undefined,
                )
              }
              class="h-8 min-w-36 rounded-md border border-(--color-border) bg-(--color-surface) px-2 text-xs font-semibold text-(--color-text) outline-none focus:ring-2 focus:ring-(--color-accent-soft)"
            >
              <option value="">All users</option>
              <For each={store.adminUsers()}>
                {(user) => <option value={user.id}>{user.name}</option>}
              </For>
            </select>
          </label>
        </Show>
      </div>

      <div class="divide-y divide-(--color-border) border-t border-(--color-border) px-4">
        <Show
          when={!store.requestsBusy()}
          fallback={
            <div class="py-4 text-center text-sm text-(--color-muted)">Loading requests...</div>
          }
        >
          <For
            each={store.requests()}
            fallback={
              <div class="py-4 text-center text-sm text-(--color-muted)">No requests yet.</div>
            }
          >
            {(request) => (
              <RequestItem
                request={request}
                busy={store.busyKey() === `request:${request.id}`}
                onDelete={() => store.deleteMediaRequest(request)}
                showRequester={Boolean(store.currentUser()?.isAdministrator)}
              />
            )}
          </For>
        </Show>
      </div>

      <Show when={pageCount() > 1}>
        <nav
          aria-label="Request pages"
          class="flex items-center justify-end gap-3 border-t border-(--color-border) px-4 py-3"
        >
          <button
            type="button"
            onClick={() => void store.showRequestPage(store.requestPage() - 1)}
            disabled={store.requestsBusy() || store.requestPage() === 1}
            class={smallSecondaryButtonClass}
          >
            Previous
          </button>
          <span class="text-xs font-semibold text-(--color-muted)">
            {store.requestPage()} of {pageCount()}
          </span>
          <button
            type="button"
            onClick={() => void store.showRequestPage(store.requestPage() + 1)}
            disabled={store.requestsBusy() || store.requestPage() === pageCount()}
            class={smallSecondaryButtonClass}
          >
            Next
          </button>
        </nav>
      </Show>
    </section>
  );
}
