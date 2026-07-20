import { For, onMount } from "solid-js";

import { RequestItem } from "../components/RequestItem";
import { routePath } from "../lib/routing";
import { useStore } from "../store";

export function HomePage() {
  const store = useStore();

  onMount(() => void store.loadRequests());

  return (
    <section class="overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-surface) shadow-(--shadow-card)">
      <div class="flex items-center justify-between gap-4 px-4 py-3">
        <h2 class="m-0 text-sm font-bold tracking-normal">Recent requests</h2>
        <a
          href={routePath({ page: "requests" })}
          onClick={(event) => {
            event.preventDefault();
            store.showRequestsRoute();
          }}
          class="rounded-md px-2 py-1 text-xs font-semibold text-(--color-muted) transition hover:bg-(--color-surface-hover) hover:text-(--color-text)"
        >
          View all
        </a>
      </div>

      <div class="divide-y divide-(--color-border) border-t border-(--color-border) px-4">
        <For
          each={store.recentRequests()}
          fallback={
            <div class="py-4 text-center text-sm text-(--color-muted)">No requests yet.</div>
          }
        >
          {(request) => (
            <RequestItem
              request={request}
              busy={store.busyKey() === `request:${request.id}`}
              onDelete={() => store.deleteMediaRequest(request)}
              showActions={false}
              showRequester={Boolean(store.currentUser()?.isAdministrator)}
            />
          )}
        </For>
      </div>
    </section>
  );
}
