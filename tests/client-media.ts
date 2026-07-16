import { expect, test } from "bun:test";

import { createSignal } from "solid-js";

import { createMediaActions } from "../src/client/state/media";
import type { AuthUser, MediaRequest, TmdbMedia } from "../src/shared/types";

function createSearchActions() {
  const [currentUser] = createSignal<AuthUser | null>({
    id: 1,
    jellyfinUserId: "jellyfin-user",
    name: "Test User",
    isAdministrator: false,
  });
  const [route] = createSignal({ page: "search" as const, query: "test" });
  const [, setRecentRequests] = createSignal<MediaRequest[]>([]);
  const [query, setQuery] = createSignal("test");
  const [, setRequests] = createSignal<MediaRequest[]>([]);
  const [, setRequestTotal] = createSignal(0);
  const [requestPage, setRequestPage] = createSignal(1);
  const [requestUserFilter, setRequestUserFilter] = createSignal<number>();
  const [, setRequestsBusy] = createSignal(false);
  const [results, setResults] = createSignal<TmdbMedia[]>([]);
  const [searchBusy, setSearchBusy] = createSignal(false);
  const [requestModalItem, setRequestModalItem] = createSignal<TmdbMedia>();
  const [selectedSeasonNumbers, setSelectedSeasonNumbers] = createSignal<number[]>([]);
  const [, setRequestModalError] = createSignal("");
  const [, setBusyKey] = createSignal("");

  const actions = createMediaActions({
    currentUser,
    route,
    setRecentRequests,
    query,
    setRequests,
    setRequestTotal,
    requestPage,
    setRequestPage,
    requestUserFilter,
    setRequestUserFilter,
    setRequestsBusy,
    recentRequestLimit: 5,
    requestPageSize: 20,
    setQuery,
    setResults,
    setSearchBusy,
    requestModalItem,
    setRequestModalItem,
    selectedSeasonNumbers,
    setSelectedSeasonNumbers,
    setRequestModalError,
    setNotice: () => undefined,
    setBusyKey,
    navigate: () => undefined,
  });

  return { actions, results, searchBusy };
}

function searchResponse(results: TmdbMedia[]): Response {
  return {
    ok: true,
    json: async () => ({ results }),
  } as Response;
}

test("resumes an invalidated search when the input returns to the route query", async () => {
  const nativeFetch = globalThis.fetch;
  const pendingResponses: Array<(response: Response) => void> = [];
  globalThis.fetch = (async (_url, _init) =>
    await new Promise<Response>((resolve) => {
      pendingResponses.push(resolve);
    })) as typeof fetch;

  try {
    const { actions, results, searchBusy } = createSearchActions();
    const restoredResult: TmdbMedia = {
      tmdbId: 2,
      mediaType: "movie",
      title: "Restored result",
    };

    actions.loadSearchRoute("test");
    actions.cancelSearchLoad({ showBusy: true });
    actions.resumeSearchRoute("test");

    expect(pendingResponses).toHaveLength(2);
    expect(searchBusy()).toBe(true);

    pendingResponses[0](searchResponse([{ tmdbId: 1, mediaType: "movie", title: "Stale result" }]));
    await Bun.sleep(0);
    expect(results()).toEqual([]);
    expect(searchBusy()).toBe(true);

    pendingResponses[1](searchResponse([restoredResult]));
    await Bun.sleep(0);
    expect(results()).toEqual([restoredResult]);
    expect(searchBusy()).toBe(false);

    actions.resumeSearchRoute("test");
    expect(pendingResponses).toHaveLength(2);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});
