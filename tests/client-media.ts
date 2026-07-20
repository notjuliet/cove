import { expect, test } from "bun:test";

import { createSignal } from "solid-js";

import type { AppRoute } from "../src/client/lib/types";
import { createMediaActions } from "../src/client/state/media";
import type { AuthUser, MediaRequest, TmdbMedia } from "../src/shared/types";

function createSearchActions(initialRoute: AppRoute = { page: "search", query: "test" }) {
  const [currentUser] = createSignal<AuthUser | null>({
    id: 1,
    jellyfinUserId: "jellyfin-user",
    name: "Test User",
    isAdministrator: false,
  });
  const [route, setRoute] = createSignal(initialRoute);
  const [recentRequests, setRecentRequests] = createSignal<MediaRequest[]>([]);
  const [query, setQuery] = createSignal("test");
  const [requests, setRequests] = createSignal<MediaRequest[]>([]);
  const [, setRequestTotal] = createSignal(0);
  const [requestPage, setRequestPage] = createSignal(1);
  const [requestUserFilter, setRequestUserFilter] = createSignal<number>();
  const [requestsBusy, setRequestsBusy] = createSignal(false);
  const [requestsLoaded, setRequestsLoaded] = createSignal(false);
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
    setRequestsLoaded,
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

  return {
    actions,
    recentRequests,
    requests,
    requestsBusy,
    requestsLoaded,
    results,
    searchBusy,
    setRoute,
  };
}

function searchResponse(results: TmdbMedia[]): Response {
  return {
    ok: true,
    json: async () => ({ results }),
  } as Response;
}

const requestFixture: MediaRequest = {
  id: 1,
  tmdbId: 10,
  mediaType: "movie",
  title: "Test movie",
  requestedByUserId: 1,
  requestedBy: "Test User",
  availability: "requested",
  createdAt: "2026-07-20T10:00:00.000Z",
};

function installPendingFetch() {
  const nativeFetch = globalThis.fetch;
  const urls: string[] = [];
  const pendingResponses: Array<(response: Response) => void> = [];
  globalThis.fetch = (async (url, _init) => {
    urls.push(String(url));
    return await new Promise<Response>((resolve) => pendingResponses.push(resolve));
  }) as typeof fetch;

  return {
    urls,
    respond(response: Response) {
      const resolve = pendingResponses.shift();
      if (!resolve) {
        throw new Error("No pending fetch to resolve.");
      }
      resolve(response);
    },
    restore() {
      globalThis.fetch = nativeFetch;
    },
  };
}

test("resumes an invalidated search when the input returns to the route query", async () => {
  const fetchMock = installPendingFetch();

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

    expect(fetchMock.urls).toHaveLength(2);
    expect(searchBusy()).toBe(true);

    fetchMock.respond(searchResponse([{ tmdbId: 1, mediaType: "movie", title: "Stale result" }]));
    await Bun.sleep(0);
    expect(results()).toEqual([]);
    expect(searchBusy()).toBe(true);

    fetchMock.respond(searchResponse([restoredResult]));
    await Bun.sleep(0);
    expect(results()).toEqual([restoredResult]);
    expect(searchBusy()).toBe(false);

    actions.resumeSearchRoute("test");
    expect(fetchMock.urls).toHaveLength(2);
  } finally {
    fetchMock.restore();
  }
});

test("preserves unchanged request rows across refreshes", async () => {
  const nativeFetch = globalThis.fetch;
  let availability = requestFixture.availability;
  globalThis.fetch = (async (_url, _init) =>
    requestResponse([{ ...requestFixture, availability }])) as typeof fetch;

  try {
    const { actions, recentRequests } = createSearchActions();

    await actions.loadRequests();
    const firstRequest = recentRequests()[0];
    await actions.loadRequests();

    expect(recentRequests()[0]).toBe(firstRequest);

    availability = "available";
    await actions.loadRequests();
    expect(recentRequests()[0]).not.toBe(firstRequest);
    expect(recentRequests()[0]?.availability).toBe("available");
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("coalesces route-specific request loads", async () => {
  const fetchMock = installPendingFetch();

  try {
    const { actions, setRoute } = createSearchActions({ page: "requests" });

    const mountLoad = actions.loadRequestPage();
    const bootLoad = actions.loadRequests();
    expect(fetchMock.urls).toEqual(["/api/requests?limit=20&offset=0"]);
    fetchMock.respond(requestResponse([]));
    await Promise.all([mountLoad, bootLoad]);

    setRoute({ page: "home" });
    const homeMountLoad = actions.loadRequests();
    const homeBootLoad = actions.loadRequests();
    expect(fetchMock.urls).toEqual(["/api/requests?limit=20&offset=0", "/api/requests?limit=5"]);
    fetchMock.respond(requestResponse([]));
    await Promise.all([homeMountLoad, homeBootLoad]);
  } finally {
    fetchMock.restore();
  }
});

test("keeps a loaded request page available while it refreshes", async () => {
  const fetchMock = installPendingFetch();

  try {
    const { actions, requests, requestsBusy, requestsLoaded } = createSearchActions();

    const initialLoad = actions.loadRequestPage();
    expect(requestsLoaded()).toBe(false);
    fetchMock.respond(requestResponse([{ ...requestFixture }]));
    await initialLoad;

    const firstRequest = requests()[0];
    expect(requestsLoaded()).toBe(true);

    const refresh = actions.loadRequestPage();
    expect(requestsBusy()).toBe(true);
    expect(requestsLoaded()).toBe(true);
    expect(requests()[0]).toBe(firstRequest);

    fetchMock.respond(requestResponse([{ ...requestFixture }]));
    await refresh;

    expect(requests()[0]).toBe(firstRequest);
    expect(requestsBusy()).toBe(false);
    expect(requestsLoaded()).toBe(true);
  } finally {
    fetchMock.restore();
  }
});

function requestResponse(requests: MediaRequest[]): Response {
  return {
    ok: true,
    json: async () => ({ requests, total: requests.length }),
  } as Response;
}
