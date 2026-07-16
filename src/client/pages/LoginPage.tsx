import { Show, createSignal } from "solid-js";

import { FormInput } from "../components/FormInput";
import { messageFor } from "../lib/api";
import { panelClass, primaryButtonClass } from "../lib/ui";

export function LoginPage(props: {
  busy: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setError("");

    try {
      await props.onLogin(username(), password());
      setPassword("");
    } catch (error) {
      setError(messageFor(error));
    }
  }

  return (
    <main class="grid min-h-screen place-items-center bg-(--color-bg) px-4 py-8 text-(--color-text)">
      <form class={`${panelClass} grid w-full max-w-sm gap-4 p-4`} onSubmit={submit}>
        <div class="grid gap-1">
          <div class="flex items-center gap-2">
            <img src="/logo.svg" alt="" class="h-8 w-8 rounded-lg" />
            <h1 class="m-0 text-2xl font-bold tracking-normal">Cove</h1>
          </div>
          <p class="m-0 text-sm text-(--color-muted)">Sign in with your Jellyfin account.</p>
        </div>

        <div class="grid gap-3">
          <FormInput
            label="Username"
            value={username()}
            onInput={setUsername}
            autocomplete="username"
          />
          <FormInput
            label="Password"
            value={password()}
            onInput={setPassword}
            type="password"
            autocomplete="current-password"
          />
        </div>

        <Show when={error()}>
          <p class="m-0 text-sm text-(--color-danger)">{error()}</p>
        </Show>

        <button type="submit" disabled={props.busy} class={primaryButtonClass}>
          {props.busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
