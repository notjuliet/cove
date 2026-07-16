import { createSignal, For, onCleanup, onMount, Show } from "solid-js";

import type { TmdbMedia, TmdbSeason } from "../../shared/types";
import { jellyfinMediaUrl, letterboxdTmdbUrl, posterUrl, seasonLabel, yearFor } from "../lib/media";
import {
  panelClass,
  primaryButtonClass,
  secondaryButtonClass,
  smallSecondaryButtonClass,
} from "../lib/ui";
import { AvailabilityStatus } from "./AvailabilityStatus";

export function RequestModal(props: {
  item: TmdbMedia;
  selectedSeasonNumbers: number[];
  busy: boolean;
  error: string;
  onToggle: (seasonNumber: number, checked: boolean) => void;
  onCancel: () => void;
  onSubmit: () => Promise<boolean>;
}) {
  const [closing, setClosing] = createSignal(false);
  const isSeries = () => props.item.mediaType === "tv";
  const seasons = () => props.item.seasons ?? [];
  const availableSeasons = () => new Set(props.item.availableSeasonNumbers ?? []);
  const mediaTypeLabel = () => (props.item.mediaType === "movie" ? "Movie" : "Series");
  const canOpenInJellyfin = () => props.item.availability === "available";
  const missingSeasonCount = () =>
    seasons().filter((season) => !availableSeasons().has(season.seasonNumber)).length;
  const canSubmitRequest = () =>
    isSeries() ? seasons().length > 0 && missingSeasonCount() > 0 : !canOpenInJellyfin();

  onMount(() => {
    const rootOverflow = document.documentElement.style.overflow;
    const bodyOverflow = document.body.style.overflow;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      }
    }

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.documentElement.style.overflow = rootOverflow;
      document.body.style.overflow = bodyOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  function dismiss() {
    if (closing()) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      props.onCancel();
      return;
    }

    setClosing(true);
  }

  async function submit() {
    if (await props.onSubmit()) {
      dismiss();
    }
  }

  return (
    <div
      class={`fixed inset-0 z-10 grid place-items-center p-4 ${closing() ? "pointer-events-none" : ""}`}
    >
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={dismiss}
        class={`dialog-backdrop absolute inset-0 cursor-default border-0 bg-black/50 p-0 ${closing() ? "dialog-backdrop-closing" : ""}`}
      />
      <dialog
        aria-modal="true"
        open
        onAnimationEnd={(event) => {
          if (closing() && event.animationName === "dialog-panel-out") {
            props.onCancel();
          }
        }}
        class={`dialog-panel relative m-0 grid w-full max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] gap-4 overflow-hidden rounded-lg bg-(--color-surface) p-4 text-(--color-text) shadow-(--shadow-soft) ${closing() ? "dialog-panel-closing" : ""}`}
      >
        <div>
          <div>
            <h2 class="m-0 text-lg font-bold tracking-normal">{props.item.title}</h2>
            <p class="text-sm text-(--color-muted)">
              {mediaTypeLabel()} · {yearFor(props.item.releaseDate)}
            </p>
          </div>
        </div>

        <div class="dialog-scroll min-h-0 overflow-y-auto pr-1">
          <div class="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <div class="aspect-2/3 w-full max-w-52 justify-self-center overflow-hidden rounded-lg bg-(--color-surface-soft) sm:max-w-none">
              <Show
                when={posterUrl(props.item.posterPath)}
                fallback={
                  <div class="grid h-full place-items-center px-4 text-center text-sm font-semibold text-(--color-muted)">
                    {props.item.title}
                  </div>
                }
              >
                {(src) => (
                  <img
                    src={src()}
                    alt={`${props.item.title} poster`}
                    class="h-full w-full object-cover"
                  />
                )}
              </Show>
            </div>

            <div class="grid content-start gap-3">
              <p class="m-0 text-sm leading-relaxed text-(--color-muted)">
                {props.item.overview || "No overview available."}
              </p>

              <div class="flex flex-wrap gap-2">
                <Show when={props.item.mediaType === "movie"}>
                  <a
                    href={letterboxdTmdbUrl(props.item)}
                    target="_blank"
                    rel="noreferrer"
                    class={smallSecondaryButtonClass}
                  >
                    Letterboxd
                  </a>
                </Show>
              </div>
            </div>
          </div>

          <Show when={isSeries()}>
            <Show
              when={seasons().length > 0}
              fallback={
                <p class={`${panelClass} mt-4 p-3 text-sm text-(--color-muted)`}>
                  TMDB did not return season details for this series.
                </p>
              }
            >
              <div class="mt-4 grid gap-2">
                <For each={seasons()}>
                  {(season) => (
                    <SeasonOption
                      season={season}
                      checked={props.selectedSeasonNumbers.includes(season.seasonNumber)}
                      available={availableSeasons().has(season.seasonNumber)}
                      onToggle={props.onToggle}
                    />
                  )}
                </For>
              </div>
            </Show>
          </Show>

          <Show when={props.error}>
            {(error) => <p class="mt-4 mb-0 text-sm text-(--color-danger)">{error()}</p>}
          </Show>
        </div>

        <div class="flex justify-end gap-2">
          <button type="button" onClick={dismiss} class={secondaryButtonClass}>
            Cancel
          </button>
          <Show when={canOpenInJellyfin()}>
            <a
              href={jellyfinMediaUrl(props.item)}
              target="_blank"
              rel="noreferrer"
              class={canSubmitRequest() ? secondaryButtonClass : primaryButtonClass}
            >
              Open in Jellyfin
            </a>
          </Show>
          <Show when={canSubmitRequest()}>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={props.busy}
              class={primaryButtonClass}
            >
              {props.busy ? "Adding..." : "Request"}
            </button>
          </Show>
        </div>
      </dialog>
    </div>
  );
}

function SeasonOption(props: {
  season: TmdbSeason;
  checked: boolean;
  available: boolean;
  onToggle: (seasonNumber: number, checked: boolean) => void;
}) {
  return (
    <label
      aria-label={seasonLabel(props.season.seasonNumber, props.season.name)}
      class={
        props.available
          ? "flex items-center gap-3 rounded-lg border border-(--color-border) bg-(--color-accent-soft) p-2 text-sm"
          : "flex items-center gap-3 rounded-lg border border-(--color-border) bg-(--color-surface-soft) p-2 text-sm"
      }
    >
      <input
        type="checkbox"
        checked={props.available || props.checked}
        disabled={props.available}
        onChange={(event) => props.onToggle(props.season.seasonNumber, event.currentTarget.checked)}
        class="h-4 w-4 accent-(--color-accent)"
      />
      <span class="min-w-0 flex-1">
        <span class="flex items-center justify-between gap-2">
          <span class="min-w-0 truncate font-semibold text-(--color-text)">
            {seasonLabel(props.season.seasonNumber, props.season.name)}
          </span>
          <Show when={props.available}>
            <AvailabilityStatus availability="available" />
          </Show>
        </span>
        <span class="block text-xs text-(--color-muted)">
          {props.season.episodeCount} {props.season.episodeCount === 1 ? "episode" : "episodes"}
          {props.season.airDate ? ` · ${yearFor(props.season.airDate)}` : ""}
        </span>
      </span>
    </label>
  );
}
