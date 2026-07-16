import { Show } from "solid-js";

import type { MediaRequest } from "../../shared/types";
import { arrMediaUrl, jellyfinMediaUrl, posterUrl, seasonListLabel, yearFor } from "../lib/media";
import { smallSecondaryButtonClass } from "../lib/ui";
import { AvailabilityStatus } from "./AvailabilityStatus";

export function RequestItem(props: {
  request: MediaRequest;
  busy: boolean;
  onDelete: () => void;
  showActions?: boolean;
  showRequester?: boolean;
}) {
  const isAvailable = () => props.request.availability === "available";
  const details = () => {
    const values = [
      props.request.releaseDate ? yearFor(props.request.releaseDate) : undefined,
      props.request.mediaType === "tv" && props.request.seasonNumbers?.length
        ? seasonListLabel(props.request.seasonNumbers)
        : undefined,
      props.showRequester ? props.request.requestedBy : undefined,
    ];

    return values.filter(Boolean).join(" · ");
  };

  return (
    <article
      class={`relative grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3.5 ${
        isAvailable() ? "group cursor-pointer" : ""
      }`}
    >
      <Show when={isAvailable()}>
        <a
          href={jellyfinMediaUrl(props.request)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${props.request.title} in Jellyfin`}
          class="absolute inset-0 z-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent) focus-visible:ring-inset"
        />
      </Show>

      <div
        class={`relative z-10 flex min-w-0 items-center gap-3 ${isAvailable() ? "pointer-events-none" : ""}`}
      >
        <Show when={posterUrl(props.request.posterPath)}>
          {(src) => (
            <img
              src={src()}
              alt=""
              class="h-12 w-8 shrink-0 rounded bg-(--color-surface-soft) object-cover"
              loading="lazy"
            />
          )}
        </Show>

        <div class="min-w-0">
          <h3 class="m-0 truncate text-sm font-bold tracking-normal transition-colors group-focus-within:text-(--color-accent) group-hover:text-(--color-accent)">
            {props.request.title}
          </h3>
          <Show when={details()}>
            <p class="mt-1 mb-0 truncate text-xs text-(--color-muted)">{details()}</p>
          </Show>
          <Show
            when={
              props.request.availability === "requested" &&
              props.request.availableSeasonNumbers?.length
            }
          >
            <p class="mt-1 mb-0 text-xs text-(--color-muted)">
              Available: {seasonListLabel(props.request.availableSeasonNumbers ?? [])}
            </p>
          </Show>
        </div>
      </div>

      <div
        class={`relative z-10 flex shrink-0 items-center gap-2 ${isAvailable() ? "pointer-events-none" : ""}`}
      >
        <AvailabilityStatus availability={props.request.availability} />
        <Show when={props.showActions !== false}>
          <div class={`flex flex-wrap gap-2 ${isAvailable() ? "pointer-events-auto" : ""}`}>
            <a
              href={arrMediaUrl(props.request)}
              target="_blank"
              rel="noreferrer"
              class={smallSecondaryButtonClass}
            >
              Manage
            </a>
            <button
              type="button"
              onClick={() => props.onDelete()}
              disabled={props.busy}
              class={smallSecondaryButtonClass}
            >
              Remove
            </button>
          </div>
        </Show>
      </div>
    </article>
  );
}
