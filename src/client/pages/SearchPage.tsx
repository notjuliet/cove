import { For, Show } from "solid-js";

import { MediaCard } from "../components/MediaCard";
import { mediaKey } from "../lib/media";
import { useStore } from "../store";

export function SearchPage() {
  const store = useStore();

  return (
    <section class="grid min-h-[45vh] content-start gap-4 pt-2">
      <div class="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
        <Show
          when={!store.searchBusy()}
          fallback={
            <div class="col-span-full py-3 text-center text-sm text-(--color-muted)">
              Searching...
            </div>
          }
        >
          <For
            each={store.results()}
            fallback={
              <div class="col-span-full py-3 text-center text-sm text-(--color-muted)">
                No titles found.
              </div>
            }
          >
            {(item) => (
              <MediaCard
                item={item}
                busy={store.busyKey() === mediaKey(item)}
                onOpen={() => void store.chooseRequest(item)}
              />
            )}
          </For>
        </Show>
      </div>
    </section>
  );
}
