import { Show, createSignal } from "solid-js";

import { FormInput } from "../components/FormInput";
import { messageFor } from "../lib/api";
import { defaultJellyfinUrl } from "../lib/integrations";
import type { FirstRunSetupInput } from "../lib/types";
import { panelClass, primaryButtonClass } from "../lib/ui";

export function SetupPage(props: {
  busy: boolean;
  onSetup: (input: FirstRunSetupInput) => Promise<void>;
}) {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const [setupToken, setSetupToken] = createSignal(params.get("setupToken") ?? "");
  const [publicOrigin, setPublicOrigin] = createSignal(window.location.origin);
  const [jellyfinUrl, setJellyfinUrl] = createSignal(defaultJellyfinUrl);
  const [jellyfinApiKey, setJellyfinApiKey] = createSignal("");
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [tmdbToken, setTmdbToken] = createSignal("");
  const [error, setError] = createSignal("");

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setError("");

    try {
      await props.onSetup({
        setupToken: setupToken(),
        publicOrigin: publicOrigin(),
        jellyfinUrl: jellyfinUrl(),
        jellyfinApiKey: jellyfinApiKey(),
        username: username(),
        password: password(),
        tmdbToken: tmdbToken(),
      });
    } catch (error) {
      setError(messageFor(error));
    }
  }

  return (
    <main class="min-h-screen px-4 py-8 text-(--color-text)">
      <form class="mx-auto grid max-w-2xl gap-5" onSubmit={submit}>
        <h1 class="m-0 text-2xl font-bold tracking-normal">Set up Cove</h1>

        <section class={`${panelClass} grid gap-3 p-4`}>
          <FormInput
            label="Setup token"
            value={setupToken()}
            onInput={setSetupToken}
            placeholder="Use the setup token from the server logs"
          />
          <FormInput
            label="Public URL"
            value={publicOrigin()}
            onInput={setPublicOrigin}
            placeholder="https://request.example.com"
          />
          <FormInput
            label="Jellyfin URL"
            value={jellyfinUrl()}
            onInput={setJellyfinUrl}
            placeholder={defaultJellyfinUrl}
          />
          <FormInput
            label="Jellyfin API key"
            type="password"
            value={jellyfinApiKey()}
            onInput={setJellyfinApiKey}
          />
          <div class="grid gap-3 sm:grid-cols-2">
            <FormInput label="Jellyfin admin user" value={username()} onInput={setUsername} />
            <FormInput
              label="Jellyfin password"
              type="password"
              value={password()}
              onInput={setPassword}
            />
          </div>
          <FormInput label="TMDB token" value={tmdbToken()} onInput={setTmdbToken} />
        </section>

        <Show when={error()}>
          <div class="rounded-lg border border-(--color-danger-border) bg-(--color-danger-soft) px-3 py-2 text-sm text-(--color-danger)">
            {error()}
          </div>
        </Show>

        <button type="submit" disabled={props.busy} class={primaryButtonClass}>
          {props.busy ? "Saving..." : "Continue to settings"}
        </button>
      </form>
    </main>
  );
}
