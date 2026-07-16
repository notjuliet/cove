import { For, Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";

import type { AdminIntegrationSettings, ArrServiceOptions } from "../../shared/types";
import { FormInput } from "../components/FormInput";
import { messageFor } from "../lib/api";
import { defaultJellyfinUrl, defaultRadarrUrl, defaultSonarrUrl } from "../lib/integrations";
import { formatBytes } from "../lib/media";
import type { ConnectionInput } from "../lib/types";
import { controlClass } from "../lib/ui";
import { useStore } from "../store";

export function SettingsPage() {
  const store = useStore();
  const defaultSettings: AdminIntegrationSettings = {
    app: {
      publicOrigin: window.location.origin,
    },
    tmdb: {
      tokenConfigured: false,
    },
    jellyfin: {
      apiKeyConfigured: false,
    },
    radarr: {
      apiKeyConfigured: false,
    },
    sonarr: {
      apiKeyConfigured: false,
    },
  };
  const settings = () => store.adminSettings() ?? defaultSettings;

  const [publicOrigin, setPublicOrigin] = createSignal(window.location.origin);
  const [jellyfinUrl, setJellyfinUrl] = createSignal(defaultJellyfinUrl);
  const [jellyfinApiKey, setJellyfinApiKey] = createSignal("");
  const [tmdbToken, setTmdbToken] = createSignal("");
  const [radarrUrl, setRadarrUrl] = createSignal(defaultRadarrUrl);
  const [radarrApiKey, setRadarrApiKey] = createSignal("");
  const [radarrRootFolderPath, setRadarrRootFolderPath] = createSignal("");
  const [radarrQualityProfileId, setRadarrQualityProfileId] = createSignal("");
  const [sonarrUrl, setSonarrUrl] = createSignal(defaultSonarrUrl);
  const [sonarrApiKey, setSonarrApiKey] = createSignal("");
  const [sonarrRootFolderPath, setSonarrRootFolderPath] = createSignal("");
  const [sonarrAnimeRootFolderPath, setSonarrAnimeRootFolderPath] = createSignal("");
  const [sonarrQualityProfileId, setSonarrQualityProfileId] = createSignal("");
  const [error, setError] = createSignal("");
  let appliedSettings: AdminIntegrationSettings | undefined;

  createEffect(() => {
    const settings = store.adminSettings();
    if (!settings || settings === appliedSettings) {
      return;
    }
    appliedSettings = settings;

    setPublicOrigin(settings.app.publicOrigin ?? window.location.origin);
    setJellyfinUrl(settings.jellyfin.url ?? defaultJellyfinUrl);
    setJellyfinApiKey("");
    setTmdbToken("");
    setRadarrUrl(settings.radarr.url ?? defaultRadarrUrl);
    setRadarrApiKey("");
    setRadarrRootFolderPath(settings.radarr.rootFolderPath ?? "");
    setRadarrQualityProfileId(String(settings.radarr.qualityProfileId ?? ""));
    setSonarrUrl(settings.sonarr.url ?? defaultSonarrUrl);
    setSonarrApiKey("");
    setSonarrRootFolderPath(settings.sonarr.rootFolderPath ?? "");
    setSonarrAnimeRootFolderPath(settings.sonarr.animeRootFolderPath ?? "");
    setSonarrQualityProfileId(String(settings.sonarr.qualityProfileId ?? ""));
  });

  let radarrConnectionKey = "";
  let sonarrConnectionKey = "";

  createEffect(() => {
    const settings = store.adminSettings();
    const nextKey = settings
      ? connectionProbeKey(radarrUrl(), radarrApiKey(), settings.radarr.apiKeyConfigured)
      : "";

    if (!nextKey) {
      radarrConnectionKey = "";
      store.clearArrOptions("radarr");
      return;
    }

    if (nextKey === radarrConnectionKey) {
      return;
    }

    const input = connectionInput(radarrUrl(), radarrApiKey());
    const timeout = window.setTimeout(() => {
      radarrConnectionKey = nextKey;
      void store.loadArrOptions("radarr", input);
    }, 500);

    onCleanup(() => window.clearTimeout(timeout));
  });

  createEffect(() => {
    const settings = store.adminSettings();
    const nextKey = settings
      ? connectionProbeKey(sonarrUrl(), sonarrApiKey(), settings.sonarr.apiKeyConfigured)
      : "";

    if (!nextKey) {
      sonarrConnectionKey = "";
      store.clearArrOptions("sonarr");
      return;
    }

    if (nextKey === sonarrConnectionKey) {
      return;
    }

    const input = connectionInput(sonarrUrl(), sonarrApiKey());
    const timeout = window.setTimeout(() => {
      sonarrConnectionKey = nextKey;
      void store.loadArrOptions("sonarr", input);
    }, 500);

    onCleanup(() => window.clearTimeout(timeout));
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setError("");

    try {
      await store.saveAdminSettings({
        publicOrigin: publicOrigin(),
        jellyfinUrl: jellyfinUrl(),
        jellyfinApiKey: jellyfinApiKey() || undefined,
        tmdbToken: tmdbToken() || undefined,
        radarrUrl: radarrUrl(),
        radarrApiKey: radarrApiKey() || undefined,
        radarrRootFolderPath: radarrRootFolderPath(),
        radarrQualityProfileId: radarrQualityProfileId(),
        sonarrUrl: sonarrUrl(),
        sonarrApiKey: sonarrApiKey() || undefined,
        sonarrRootFolderPath: sonarrRootFolderPath(),
        sonarrAnimeRootFolderPath: sonarrAnimeRootFolderPath(),
        sonarrQualityProfileId: sonarrQualityProfileId(),
      });
    } catch (error) {
      setError(messageFor(error));
    }
  }

  return (
    <form id="admin-settings-form" class="grid gap-5" onSubmit={submit}>
      <fieldset
        disabled={store.settingsBusy() || !store.adminSettings()}
        class="m-0 grid border-0 p-0 lg:grid-cols-2"
      >
        <div class="grid content-start gap-3 pb-5 lg:border-r lg:border-(--color-border) lg:pr-5">
          <PanelHeader title="General" />
          <FormInput
            label="Public URL"
            value={publicOrigin()}
            onInput={setPublicOrigin}
            placeholder="https://request.example.com"
          />
          <FormInput
            label="TMDB token"
            type="password"
            value={tmdbToken()}
            onInput={setTmdbToken}
            placeholder={settings().tmdb.tokenConfigured ? "******" : undefined}
            maskedPlaceholder={settings().tmdb.tokenConfigured}
            hint={settings().tmdb.tokenConfigured ? undefined : "Required for search."}
          />
        </div>

        <div class="grid content-start gap-3 border-t border-(--color-border) pt-5 pb-5 lg:border-t-0 lg:pt-0 lg:pl-5">
          <PanelHeader
            title="Jellyfin"
            action={
              <button
                type="button"
                onClick={() => void store.syncJellyfinAvailability()}
                disabled={store.syncBusy() || !store.adminSettings()}
                class="rounded-md px-2 py-1 text-xs font-semibold text-(--color-muted) transition hover:bg-(--color-surface-hover) hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-60"
              >
                Scan
              </button>
            }
          />
          <FormInput
            label="URL"
            value={jellyfinUrl()}
            onInput={setJellyfinUrl}
            placeholder={defaultJellyfinUrl}
          />
          <FormInput
            label="API key"
            type="password"
            value={jellyfinApiKey()}
            onInput={setJellyfinApiKey}
            placeholder={settings().jellyfin.apiKeyConfigured ? "******" : undefined}
            maskedPlaceholder={settings().jellyfin.apiKeyConfigured}
            hint={settings().jellyfin.apiKeyConfigured ? undefined : "Required for scanning."}
          />
        </div>

        <div class="grid content-start gap-3 border-t border-(--color-border) py-5 lg:border-r lg:border-(--color-border) lg:pr-5">
          <ArrSettingsHeader
            title="Radarr"
            busy={Boolean(store.arrOptionsBusy().radarr)}
            failed={Boolean(store.arrOptionsError().radarr)}
            canRefresh={Boolean(
              connectionProbeKey(radarrUrl(), radarrApiKey(), settings().radarr.apiKeyConfigured),
            )}
            onRefresh={() =>
              store.loadArrOptions("radarr", connectionInput(radarrUrl(), radarrApiKey()))
            }
          />
          <FormInput
            label="URL"
            value={radarrUrl()}
            onInput={setRadarrUrl}
            placeholder={defaultRadarrUrl}
          />
          <FormInput
            label="API key"
            type="password"
            value={radarrApiKey()}
            onInput={setRadarrApiKey}
            placeholder={settings().radarr.apiKeyConfigured ? "******" : undefined}
            maskedPlaceholder={settings().radarr.apiKeyConfigured}
          />
          <ArrRootFolderControl
            value={radarrRootFolderPath()}
            options={store.arrOptions().radarr?.rootFolders}
            onInput={setRadarrRootFolderPath}
          />
          <ArrQualityProfileControl
            value={radarrQualityProfileId()}
            options={store.arrOptions().radarr?.qualityProfiles}
            onInput={setRadarrQualityProfileId}
          />
        </div>

        <div class="grid content-start gap-3 border-t border-(--color-border) pt-5 lg:pl-5">
          <ArrSettingsHeader
            title="Sonarr"
            busy={Boolean(store.arrOptionsBusy().sonarr)}
            failed={Boolean(store.arrOptionsError().sonarr)}
            canRefresh={Boolean(
              connectionProbeKey(sonarrUrl(), sonarrApiKey(), settings().sonarr.apiKeyConfigured),
            )}
            onRefresh={() =>
              store.loadArrOptions("sonarr", connectionInput(sonarrUrl(), sonarrApiKey()))
            }
          />
          <FormInput
            label="URL"
            value={sonarrUrl()}
            onInput={setSonarrUrl}
            placeholder={defaultSonarrUrl}
          />
          <FormInput
            label="API key"
            type="password"
            value={sonarrApiKey()}
            onInput={setSonarrApiKey}
            placeholder={settings().sonarr.apiKeyConfigured ? "******" : undefined}
            maskedPlaceholder={settings().sonarr.apiKeyConfigured}
          />
          <ArrRootFolderControl
            value={sonarrRootFolderPath()}
            options={store.arrOptions().sonarr?.rootFolders}
            onInput={setSonarrRootFolderPath}
          />
          <ArrRootFolderControl
            label="Anime root folder"
            value={sonarrAnimeRootFolderPath()}
            options={store.arrOptions().sonarr?.rootFolders}
            onInput={setSonarrAnimeRootFolderPath}
          />
          <ArrQualityProfileControl
            value={sonarrQualityProfileId()}
            options={store.arrOptions().sonarr?.qualityProfiles}
            onInput={setSonarrQualityProfileId}
          />
        </div>
      </fieldset>

      <Show when={error()}>
        <div class="rounded-lg border border-(--color-danger-border) bg-(--color-danger-soft) px-3 py-2 text-sm text-(--color-danger)">
          {error()}
        </div>
      </Show>
    </form>
  );
}

function PanelHeader(props: { title: string; action?: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-2">
      <h3 class="m-0 text-sm font-bold tracking-normal">{props.title}</h3>
      <div class="ml-auto flex min-h-7 min-w-20 items-center justify-end gap-2">{props.action}</div>
    </div>
  );
}

function ConnectionStatusBadge(props: { failed: boolean }) {
  return (
    <Show when={props.failed}>
      <span class="rounded-full border border-(--color-danger-border) bg-(--color-danger-soft) px-2 py-0.5 text-xs font-semibold text-(--color-danger)">
        Unavailable
      </span>
    </Show>
  );
}

function ArrSettingsHeader(props: {
  title: string;
  busy: boolean;
  failed: boolean;
  canRefresh: boolean;
  onRefresh: () => Promise<void>;
}) {
  return (
    <PanelHeader
      title={props.title}
      action={
        <>
          <ConnectionStatusBadge failed={props.failed} />
          <Show when={props.busy || props.canRefresh}>
            <button
              type="button"
              onClick={() => void props.onRefresh()}
              disabled={props.busy || !props.canRefresh}
              class="rounded-md px-2 py-1 text-xs font-semibold text-(--color-muted) transition hover:bg-(--color-surface-hover) hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-60"
            >
              Refresh
            </button>
          </Show>
        </>
      }
    />
  );
}

function ArrRootFolderControl(props: {
  label?: string;
  value: string;
  options?: ArrServiceOptions["rootFolders"];
  onInput: (value: string) => void;
}) {
  const options = () => props.options ?? [];
  const hasOptions = () => options().length > 0;
  let select: HTMLSelectElement | undefined;

  createEffect(() => {
    options();
    if (select && select.value !== props.value) {
      select.value = props.value;
    }
  });

  return (
    <label class="grid gap-1 text-sm">
      <span class="font-semibold text-(--color-muted)">{props.label ?? "Root folder"}</span>
      <select
        ref={(element) => {
          select = element;
        }}
        value={props.value}
        disabled={!hasOptions()}
        onChange={(event) => props.onInput(event.currentTarget.value)}
        class={`${controlClass} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <option value="">
          {hasOptions() ? "Select a root folder" : "Root folders unavailable"}
        </option>
        <Show when={props.value && !options().some((option) => option.path === props.value)}>
          <option value={props.value}>{props.value}</option>
        </Show>
        <For each={options()}>
          {(option) => (
            <option value={option.path}>
              {option.path}
              {option.freeSpace === undefined ? "" : ` (${formatBytes(option.freeSpace)} free)`}
            </option>
          )}
        </For>
      </select>
    </label>
  );
}

function ArrQualityProfileControl(props: {
  label?: string;
  value: string;
  options?: ArrServiceOptions["qualityProfiles"];
  onInput: (value: string) => void;
}) {
  const options = () => props.options ?? [];
  const hasOptions = () => options().length > 0;
  let select: HTMLSelectElement | undefined;

  createEffect(() => {
    options();
    if (select && select.value !== props.value) {
      select.value = props.value;
    }
  });

  return (
    <label class="grid gap-1 text-sm">
      <span class="font-semibold text-(--color-muted)">{props.label ?? "Quality profile"}</span>
      <select
        ref={(element) => {
          select = element;
        }}
        value={props.value}
        disabled={!hasOptions()}
        onChange={(event) => props.onInput(event.currentTarget.value)}
        class={`${controlClass} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <option value="">
          {hasOptions() ? "Select a quality profile" : "Quality profiles unavailable"}
        </option>
        <Show when={props.value && !options().some((option) => String(option.id) === props.value)}>
          <option value={props.value}>Profile {props.value}</option>
        </Show>
        <For each={options()}>
          {(option) => <option value={String(option.id)}>{option.name}</option>}
        </For>
      </select>
    </label>
  );
}

function connectionProbeKey(url: string, apiKey: string, hasSavedApiKey: boolean): string {
  const normalizedUrl = url.trim();
  const normalizedApiKey = apiKey.trim();
  if (!normalizedUrl || (!normalizedApiKey && !hasSavedApiKey)) {
    return "";
  }

  return `${normalizedUrl}\n${normalizedApiKey ? `typed:${normalizedApiKey}` : "saved"}`;
}

function connectionInput(url: string, apiKey: string): ConnectionInput {
  return {
    url: url.trim() || undefined,
    apiKey: apiKey.trim() || undefined,
  };
}
