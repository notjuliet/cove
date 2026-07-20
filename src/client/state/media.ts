import { createSignal, type Accessor } from "solid-js";

import type { AuthUser, MediaRequest, MediaRequestPage, TmdbMedia } from "../../shared/types";
import { api, messageFor } from "../lib/api";
import { mediaKey } from "../lib/media";
import type { AppRoute, NoticeTone } from "../lib/types";

type MediaStateInput = {
  currentUser: Accessor<AuthUser | null>;
  route: Accessor<AppRoute>;
  recentRequestLimit: number;
  requestPageSize: number;
  setNotice: (message: string, tone?: NoticeTone) => void;
  navigate: (nextRoute: AppRoute, options?: { replace?: boolean }) => void;
};

export function createMediaState({
  currentUser,
  route,
  recentRequestLimit,
  requestPageSize,
  setNotice,
  navigate,
}: MediaStateInput) {
  const [recentRequests, setRecentRequests] = createSignal<MediaRequest[]>([]);
  const [requests, setRequests] = createSignal<MediaRequest[]>([]);
  const [requestTotal, setRequestTotal] = createSignal(0);
  const [requestPage, setRequestPage] = createSignal(1);
  const [requestUserFilter, setRequestUserFilter] = createSignal<number>();
  const [requestsBusy, setRequestsBusy] = createSignal(false);
  const [requestsLoaded, setRequestsLoaded] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<TmdbMedia[]>([]);
  const [searchBusy, setSearchBusy] = createSignal(false);
  const [requestModalItem, setRequestModalItem] = createSignal<TmdbMedia>();
  const [selectedSeasonNumbers, setSelectedSeasonNumbers] = createSignal<number[]>([]);
  const [requestModalError, setRequestModalError] = createSignal("");
  const [busyKey, setBusyKey] = createSignal("");
  let searchLoadToken = 0;
  let searchLoadInvalidated = false;
  let recentRequestsLoadToken = 0;
  let requestPageLoadToken = 0;
  const requestLoads = new Map<string, Promise<void>>();

  function coalesceRequestLoad(key: string, load: () => Promise<void>): Promise<void> {
    const activeLoad = requestLoads.get(key);
    if (activeLoad) {
      return activeLoad;
    }

    const promise = load().finally(() => requestLoads.delete(key));
    requestLoads.set(key, promise);
    return promise;
  }

  function loadRecentRequests() {
    const user = currentUser();
    return coalesceRequestLoad(`recent:${user?.id ?? "signed-out"}`, async () => {
      const token = ++recentRequestsLoadToken;
      if (!user) {
        setRecentRequests([]);
        return;
      }

      const params = new URLSearchParams({ limit: String(recentRequestLimit) });
      const data = await api<MediaRequestPage>(`/api/requests?${params}`);
      if (token === recentRequestsLoadToken) {
        setRecentRequests((current) => preserveUnchangedRequests(current, data.requests));
      }
    });
  }

  function loadRequestPage(): Promise<void> {
    const user = currentUser();
    const requestedPage = requestPage();
    const requestedByUserId = user?.isAdministrator ? requestUserFilter() : undefined;
    const key = `page:${user?.id ?? "signed-out"}:${requestedPage}:${requestedByUserId ?? "all"}`;
    return coalesceRequestLoad(key, async () => {
      const token = ++requestPageLoadToken;
      if (!user) {
        setRequests([]);
        setRequestTotal(0);
        setRequestPage(1);
        setRequestUserFilter(undefined);
        setRequestsBusy(false);
        setRequestsLoaded(false);
        return;
      }

      const params = new URLSearchParams({
        limit: String(requestPageSize),
        offset: String((requestedPage - 1) * requestPageSize),
      });
      if (requestedByUserId) {
        params.set("requestedByUserId", String(requestedByUserId));
      }

      setRequestsBusy(true);
      try {
        const data = await api<MediaRequestPage>(`/api/requests?${params}`);
        if (token !== requestPageLoadToken) {
          return;
        }

        const lastPage = Math.max(1, Math.ceil(data.total / requestPageSize));
        if (requestedPage > lastPage) {
          setRequestPage(lastPage);
          await loadRequestPage();
          return;
        }

        setRequests((current) => preserveUnchangedRequests(current, data.requests));
        setRequestTotal(data.total);
      } catch (error) {
        if (token === requestPageLoadToken) {
          setNotice(messageFor(error), "error");
        }
      } finally {
        if (token === requestPageLoadToken) {
          setRequestsBusy(false);
          setRequestsLoaded(true);
        }
      }
    });
  }

  async function loadRequests() {
    if (!currentUser()) {
      await Promise.all([loadRecentRequests(), loadRequestPage()]);
      return;
    }

    if (route().page === "requests") {
      await loadRequestPage();
      return;
    }

    await loadRecentRequests();
  }

  async function showRequestPage(page: number) {
    setRequestPage(Math.max(1, page));
    await loadRequestPage();
  }

  async function filterRequestsByUser(requestedByUserId?: number) {
    setRequestUserFilter(requestedByUserId);
    setRequestPage(1);
    await loadRequestPage();
  }

  function showRequestsForUser(requestedByUserId: number) {
    setRequestUserFilter(requestedByUserId);
    setRequestPage(1);
    navigate({ page: "requests" });
  }

  async function deleteMediaRequest(request: MediaRequest) {
    if (!window.confirm(`Remove the request for ${request.title}?`)) {
      return;
    }

    setBusyKey(`request:${request.id}`);
    setNotice("");

    try {
      await api(`/api/requests/${request.id}`, {
        method: "DELETE",
      });
      setNotice(`${request.title} was removed from the queue.`);
      await loadRequests();
    } catch (error) {
      setNotice(messageFor(error), "error");
    } finally {
      setBusyKey("");
    }
  }

  function cancelSearchLoad(options: { showBusy?: boolean } = {}) {
    searchLoadToken++;
    searchLoadInvalidated = true;
    if (options.showBusy) {
      setSearchBusy(true);
    }
  }

  function clearSearchState() {
    cancelSearchLoad();
    setSearchBusy(false);
    setQuery("");
    setResults([]);
    setRequestModalItem(undefined);
  }

  function closeRequestModal() {
    setRequestModalItem(undefined);
  }

  function loadSearchRoute(searchQuery: string) {
    setQuery(searchQuery);
    setRequestModalItem(undefined);
    searchLoadInvalidated = false;

    if (!currentUser()) {
      setSearchBusy(false);
      setResults([]);
      return;
    }

    const token = ++searchLoadToken;
    void loadSearchResults(searchQuery, token);
  }

  function resumeSearchRoute(searchQuery: string) {
    if (searchLoadInvalidated) {
      loadSearchRoute(searchQuery);
    }
  }

  function runSearch(event: SubmitEvent) {
    event.preventDefault();
    setNotice("");

    if (!currentUser()) {
      setNotice("Sign in with Jellyfin before searching.", "error");
      return;
    }

    if (!query().trim()) {
      navigate({ page: "home" });
      return;
    }

    navigate({ page: "search", query: query().trim() });
  }

  async function loadSearchResults(searchQuery: string, token: number) {
    setNotice("");
    setSearchBusy(true);

    try {
      const params = new URLSearchParams({
        q: searchQuery,
        type: "multi",
      });
      const data = await api<{ results: TmdbMedia[] }>(`/api/search?${params}`);
      if (token !== searchLoadToken) {
        return;
      }
      setResults(data.results);
    } catch (error) {
      if (token !== searchLoadToken) {
        return;
      }
      setResults([]);
      setNotice(messageFor(error), "error");
    } finally {
      if (token === searchLoadToken) {
        setSearchBusy(false);
      }
    }
  }

  async function chooseRequest(item: TmdbMedia) {
    if (item.mediaType !== "tv") {
      setRequestModalError("");
      setSelectedSeasonNumbers([]);
      setRequestModalItem(item);
      return;
    }

    setBusyKey(mediaKey(item));
    setNotice("");
    setRequestModalError("");

    try {
      const data = await api<{ item: TmdbMedia }>(`/api/tmdb/tv/${item.tmdbId}`);
      setResults((current) =>
        current.map((result) => (mediaKey(result) === mediaKey(data.item) ? data.item : result)),
      );

      const seasons = data.item.seasons ?? [];
      const availableSeasons = new Set(data.item.availableSeasonNumbers ?? []);
      const regularSeasonNumbers = seasons
        .filter((season) => season.seasonNumber > 0 && !availableSeasons.has(season.seasonNumber))
        .map((season) => season.seasonNumber);
      const missingSeasonNumbers = seasons
        .filter((season) => !availableSeasons.has(season.seasonNumber))
        .map((season) => season.seasonNumber);

      setRequestModalItem(data.item);
      setSelectedSeasonNumbers(
        regularSeasonNumbers.length > 0 ? regularSeasonNumbers : missingSeasonNumbers,
      );
    } catch (error) {
      setNotice(messageFor(error), "error");
    } finally {
      setBusyKey("");
    }
  }

  async function requestMedia(item: TmdbMedia, seasonNumbers?: number[]) {
    const user = currentUser();
    if (!user) {
      setNotice("Sign in with Jellyfin before requesting media.", "error");
      return false;
    }

    const key = mediaKey(item);
    setBusyKey(key);
    setNotice("");

    try {
      await api("/api/requests", {
        method: "POST",
        body: JSON.stringify({
          mediaType: item.mediaType,
          tmdbId: item.tmdbId,
          title: item.title,
          posterPath: item.posterPath,
          backdropPath: item.backdropPath,
          releaseDate: item.releaseDate,
          seasonNumbers,
        }),
      });
      setNotice(`${item.title} is in the request queue.`);
      await loadRequests();
      return true;
    } catch (error) {
      setNotice(messageFor(error), "error");
      return false;
    } finally {
      setBusyKey("");
    }
  }

  function toggleSeason(seasonNumber: number, checked: boolean) {
    setSelectedSeasonNumbers((current) =>
      checked
        ? [...new Set([...current, seasonNumber])].sort((a, b) => a - b)
        : current.filter((value) => value !== seasonNumber),
    );
  }

  async function submitRequest() {
    const item = requestModalItem();
    if (!item) {
      return false;
    }

    if (item.mediaType === "tv" && selectedSeasonNumbers().length === 0) {
      setRequestModalError("Select at least one season.");
      return false;
    }

    setRequestModalError("");
    return requestMedia(item, item.mediaType === "tv" ? selectedSeasonNumbers() : undefined);
  }

  return {
    recentRequests,
    requests,
    requestTotal,
    requestPage,
    requestUserFilter,
    requestsBusy,
    requestsLoaded,
    query,
    results,
    searchBusy,
    requestModalItem,
    selectedSeasonNumbers,
    requestModalError,
    busyKey,
    setQuery,
    loadRequests,
    loadRequestPage,
    showRequestPage,
    filterRequestsByUser,
    showRequestsForUser,
    deleteMediaRequest,
    cancelSearchLoad,
    clearSearchState,
    closeRequestModal,
    loadSearchRoute,
    resumeSearchRoute,
    runSearch,
    chooseRequest,
    toggleSeason,
    submitRequest,
  };
}

function preserveUnchangedRequests(
  current: MediaRequest[],
  incoming: MediaRequest[],
): MediaRequest[] {
  const currentById = new Map(current.map((request) => [request.id, request]));

  return incoming.map((request) => {
    const previous = currentById.get(request.id);
    return previous && requestsMatch(previous, request) ? previous : request;
  });
}

function requestsMatch(first: MediaRequest, second: MediaRequest): boolean {
  const keys = Object.keys(first) as Array<keyof MediaRequest>;
  return (
    keys.length === Object.keys(second).length &&
    keys.every((key) => {
      const firstValue = first[key];
      const secondValue = second[key];
      return Array.isArray(firstValue) && Array.isArray(secondValue)
        ? firstValue.length === secondValue.length &&
            firstValue.every((value, index) => value === secondValue[index])
        : firstValue === secondValue;
    })
  );
}
