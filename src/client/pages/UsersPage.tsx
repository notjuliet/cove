import { For, Show, createMemo, createSignal } from "solid-js";

import type { AdminUser } from "../../shared/types";
import { userAvatarUrl } from "../lib/media";
import { routePath } from "../lib/routing";
import { controlClass, panelClass } from "../lib/ui";
import { useStore } from "../store";

export function UsersPage() {
  const store = useStore();
  const [search, setSearch] = createSignal("");
  const filteredUsers = createMemo(() => {
    const query = search().trim().toLowerCase();
    if (!query) {
      return store.adminUsers();
    }

    return store
      .adminUsers()
      .filter(
        (user) =>
          user.name.toLowerCase().includes(query) || roleLabel(user).toLowerCase().includes(query),
      );
  });

  return (
    <section class="grid gap-5">
      <label class="min-w-0">
        <span class="sr-only">Search users</span>
        <input
          value={search()}
          onInput={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search users"
          class={controlClass}
        />
      </label>

      <div class="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
        <Show
          when={!store.usersBusy()}
          fallback={
            <div
              class={`${panelClass} grid min-h-20 content-center p-4 text-sm text-(--color-muted)`}
            >
              Loading users...
            </div>
          }
        >
          <For
            each={filteredUsers()}
            fallback={
              <div
                class={`${panelClass} grid min-h-20 content-center p-4 text-sm text-(--color-muted)`}
              >
                No users found.
              </div>
            }
          >
            {(user) => <UserCard user={user} />}
          </For>
        </Show>
      </div>
    </section>
  );
}

function UserCard(props: { user: AdminUser }) {
  const store = useStore();
  const [avatarFailed, setAvatarFailed] = createSignal(false);

  return (
    <article aria-label={`User ${props.user.name}`} class={`${panelClass} min-h-20 p-4`}>
      <div class="flex min-w-0 items-start gap-3">
        <Show
          when={!avatarFailed()}
          fallback={
            <div
              aria-hidden="true"
              class="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-(--color-border) bg-(--color-surface-soft) text-xs font-bold text-(--color-muted) uppercase"
            >
              {userInitial(props.user.name)}
            </div>
          }
        >
          <img
            src={userAvatarUrl(props.user.id)}
            alt={`${props.user.name} avatar`}
            aria-label={`${props.user.name} avatar`}
            class="h-10 w-10 shrink-0 rounded-full bg-(--color-surface-soft) object-cover"
            loading="lazy"
            onError={() => setAvatarFailed(true)}
          />
        </Show>

        <div class="grid min-w-0 gap-1 pt-0.5">
          <div class="flex min-w-0 items-center gap-1.5">
            <h3 class="m-0 truncate text-sm font-bold tracking-normal">{props.user.name}</h3>
            <Show when={props.user.isAdministrator}>
              <span class="shrink-0 text-xs font-semibold text-(--color-muted)">Admin</span>
            </Show>
          </div>
          <a
            href={routePath({ page: "requests" })}
            onClick={(event) => {
              event.preventDefault();
              store.showRequestsForUser(props.user.id);
            }}
            class="w-fit text-xs font-semibold text-(--color-muted) transition hover:text-(--color-text)"
          >
            {requestCountLabel(props.user.requestCount)}
          </a>
        </div>
      </div>
    </article>
  );
}

function roleLabel(user: AdminUser): string {
  return user.isAdministrator ? "Admin" : "User";
}

function requestCountLabel(count: number): string {
  return `${count} ${count === 1 ? "request" : "requests"}`;
}

function userInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}
