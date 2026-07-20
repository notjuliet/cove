import { expect, test } from "bun:test";

import { createSignal } from "solid-js";

import type { AppRoute } from "../src/client/lib/types";
import { createMediaState } from "../src/client/state/media";
import type { AuthUser, MediaRequest, TmdbMedia } from "../src/shared/types";

function createSearchActions(initialRoute: AppRoute = { page: "search", query: "test" }) {
  const [currentUser] = createSignal<AuthUser | null>({
    id: 1,
    jellyfinUserId: "jellyfin-user",
    name: "Test User",
    isAdministrator: false,
  });
  const [route, setRoute] = createSignal(initialRoute);
  const media = createMediaState({
    currentUser,
    route,
    recentRequestLimit: 5,
    requestPageSize: 20,
    setNotice: () => undefined,
    navigate: () => undefined,
  });

  return { ...media, setRoute };
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
    const media = createSearchActions();
    const restoredResult: TmdbMedia = {
      tmdbId: 2,
      mediaType: "movie",
      title: "Restored result",
    };

    media.loadSearchRoute("test");
    media.cancelSearchLoad({ showBusy: true });
    media.resumeSearchRoute("test");

    expect(fetchMock.urls).toHaveLength(2);
    expect(media.searchBusy()).toBe(true);

    fetchMock.respond(searchResponse([{ tmdbId: 1, mediaType: "movie", title: "Stale result" }]));
    await Bun.sleep(0);
    expect(media.results()).toEqual([]);
    expect(media.searchBusy()).toBe(true);

    fetchMock.respond(searchResponse([restoredResult]));
    await Bun.sleep(0);
    expect(media.results()).toEqual([restoredResult]);
    expect(media.searchBusy()).toBe(false);

    media.resumeSearchRoute("test");
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
    const media = createSearchActions();

    await media.loadRequests();
    const firstRequest = media.recentRequests()[0];
    await media.loadRequests();

    expect(media.recentRequests()[0]).toBe(firstRequest);

    availability = "available";
    await media.loadRequests();
    expect(media.recentRequests()[0]).not.toBe(firstRequest);
    expect(media.recentRequests()[0]?.availability).toBe("available");
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("coalesces route-specific request loads", async () => {
  const fetchMock = installPendingFetch();

  try {
    const media = createSearchActions({ page: "requests" });

    const mountLoad = media.loadRequestPage();
    const bootLoad = media.loadRequests();
    expect(fetchMock.urls).toEqual(["/api/requests?limit=20&offset=0"]);
    fetchMock.respond(requestResponse([]));
    await Promise.all([mountLoad, bootLoad]);

    media.setRoute({ page: "home" });
    const homeMountLoad = media.loadRequests();
    const homeBootLoad = media.loadRequests();
    expect(media.recentRequestsLoaded()).toBe(false);
    expect(fetchMock.urls).toEqual(["/api/requests?limit=20&offset=0", "/api/requests?limit=5"]);
    fetchMock.respond(requestResponse([]));
    await Promise.all([homeMountLoad, homeBootLoad]);
    expect(media.recentRequestsLoaded()).toBe(true);
  } finally {
    fetchMock.restore();
  }
});

test("keeps a loaded request page available while it refreshes", async () => {
  const fetchMock = installPendingFetch();

  try {
    const media = createSearchActions();

    const initialLoad = media.loadRequestPage();
    expect(media.requestsLoaded()).toBe(false);
    fetchMock.respond(requestResponse([{ ...requestFixture }]));
    await initialLoad;

    const firstRequest = media.requests()[0];
    expect(media.requestsLoaded()).toBe(true);

    const refresh = media.loadRequestPage();
    expect(media.requestsBusy()).toBe(true);
    expect(media.requestsLoaded()).toBe(true);
    expect(media.requests()[0]).toBe(firstRequest);

    fetchMock.respond(requestResponse([{ ...requestFixture }]));
    await refresh;

    expect(media.requests()[0]).toBe(firstRequest);
    expect(media.requestsBusy()).toBe(false);
    expect(media.requestsLoaded()).toBe(true);
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
