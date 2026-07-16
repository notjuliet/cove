import { Show, createSignal } from "solid-js";

import type { AuthUser } from "../../shared/types";
import { userAvatarUrl } from "../lib/media";
import { routePath } from "../lib/routing";

export function AuthPanel(props: {
  user: AuthUser;
  busy: boolean;
  canManageAdmin: boolean;
  onLogout: () => Promise<void>;
  onRequests: () => void;
  onAdmin: () => void;
}) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  let menuRef: HTMLDivElement | undefined;

  function closeMenuOnFocusOut(event: FocusEvent) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && menuRef?.contains(nextTarget)) {
      return;
    }

    setMenuOpen(false);
  }

  function closeMenuOnEscape(event: KeyboardEvent) {
    if (event.key === "Escape") {
      setMenuOpen(false);
    }
  }

  function openAdmin(event: MouseEvent) {
    event.preventDefault();
    setMenuOpen(false);
    props.onAdmin();
  }

  function openRequests(event: MouseEvent) {
    event.preventDefault();
    setMenuOpen(false);
    props.onRequests();
  }

  async function signOut() {
    setMenuOpen(false);
    await props.onLogout();
  }

  return (
    <div
      ref={(element) => {
        menuRef = element;
      }}
      class="relative"
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen()}
        onClick={() => setMenuOpen((open) => !open)}
        onFocusOut={closeMenuOnFocusOut}
        onKeyDown={closeMenuOnEscape}
        disabled={props.busy}
        class="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-transparent bg-transparent px-2.5 text-sm font-semibold text-(--color-text) transition hover:bg-(--color-surface-hover) disabled:cursor-not-allowed disabled:opacity-60"
      >
        <img
          src={userAvatarUrl(props.user.id)}
          alt=""
          class="h-5 w-5 rounded-full object-cover"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
        {props.user.name}
      </button>

      <Show when={menuOpen()}>
        <div
          role="menu"
          tabIndex={-1}
          onFocusOut={closeMenuOnFocusOut}
          onKeyDown={closeMenuOnEscape}
          class="absolute right-0 z-20 mt-2 grid w-40 gap-1 rounded-lg border border-(--color-border) bg-(--color-surface) p-1 shadow-(--shadow-soft)"
        >
          <a
            href={routePath({ page: "requests" })}
            role="menuitem"
            onClick={openRequests}
            class="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-(--color-text) transition hover:bg-(--color-surface-hover)"
          >
            Requests
          </a>
          <Show when={props.canManageAdmin}>
            <a
              href={routePath({ page: "admin", tab: "users" })}
              role="menuitem"
              onClick={openAdmin}
              class="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-(--color-text) transition hover:bg-(--color-surface-hover)"
            >
              Admin
            </a>
          </Show>
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            disabled={props.busy}
            class="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-(--color-text) transition hover:bg-(--color-surface-hover) disabled:cursor-not-allowed disabled:opacity-60"
          >
            Sign out
          </button>
        </div>
      </Show>
    </div>
  );
}
