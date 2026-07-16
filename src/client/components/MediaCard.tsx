import { Show } from "solid-js";

import type { TmdbMedia } from "../../shared/types";
import { posterUrl, yearFor } from "../lib/media";

export function MediaCard(props: { item: TmdbMedia; busy: boolean; onOpen: () => void }) {
  const searchBadgeAvailability = () =>
    props.item.availability === "available" ? props.item.availability : undefined;

  return (
    <article
      class={`relative aspect-2/3 overflow-hidden rounded-xl bg-(--color-surface-soft) transition duration-200 ease-out hover:-translate-y-1 hover:shadow-(--shadow-soft) motion-reduce:transform-none motion-reduce:transition-none ${props.busy ? "opacity-70" : ""}`}
    >
      <button
        type="button"
        onClick={props.onOpen}
        disabled={props.busy}
        aria-label={`View details for ${props.item.title}`}
        aria-busy={props.busy}
        class="absolute inset-0 z-10 rounded-xl border-0 bg-transparent p-0 outline-none focus:ring-2 focus:ring-(--color-accent-soft)"
      />
      <Show when={posterUrl(props.item.posterPath)}>
        {(src) => (
          <img
            src={src()}
            alt={`${props.item.title} poster`}
            class="h-full w-full object-cover"
            loading="lazy"
          />
        )}
      </Show>
      <div class="absolute inset-x-0 top-0 bg-linear-to-b from-black/80 to-transparent px-3 pt-3 pb-4 text-white">
        <h3 class="m-0 line-clamp-2 min-w-0 text-[0.8125rem] leading-snug font-bold tracking-normal">
          {props.item.title}
        </h3>
        <p class="mt-1 mb-0 text-xs text-white/75">{yearFor(props.item.releaseDate)}</p>
      </div>
      <Show when={searchBadgeAvailability()}>
        <div class="absolute inset-x-0 bottom-0 flex justify-end bg-linear-to-t from-black/75 to-transparent px-3 pt-10 pb-3">
          <span class="text-xs font-medium text-white">Available</span>
        </div>
      </Show>
    </article>
  );
}
