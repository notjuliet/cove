import type { Accessor, Setter } from "solid-js";

import type { AuthUser, MediaRequest, MediaRequestPage, TmdbMedia } from "../../shared/types";
import { api, messageFor } from "../lib/api";
import { mediaKey } from "../lib/media";
import type { AppRoute, NoticeTone } from "../lib/types";

type MediaActionsInput = {
  currentUser: Accessor<AuthUser | null>;
  route: Accessor<AppRoute>;
  setRecentRequests: Setter<MediaRequest[]>;
  query: Accessor<string>;
  setRequests: Setter<MediaRequest[]>;
  setRequestTotal: Setter<number>;
  requestPage: Accessor<number>;
  setRequestPage: Setter<number>;
  requestUserFilter: Accessor<number | undefined>;
  setRequestUserFilter: Setter<number | undefined>;
  setRequestsBusy: Setter<boolean>;
  recentRequestLimit: number;
  requestPageSize: number;
  setQuery: Setter<string>;
  setResults: Setter<TmdbMedia[]>;
  setSearchBusy: Setter<boolean>;
  requestModalItem: Accessor<TmdbMedia | undefined>;
  setRequestModalItem: Setter<TmdbMedia | undefined>;
  selectedSeasonNumbers: Accessor<number[]>;
  setSelectedSeasonNumbers: Setter<number[]>;
  setRequestModalError: Setter<string>;
  setNotice: (message: string, tone?: NoticeTone) => void;
  setBusyKey: Setter<string>;
  navigate: (nextRoute: AppRoute, options?: { replace?: boolean }) => void;
};

export function createMediaActions({
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
  recentRequestLimit,
  requestPageSize,
  setQuery,
  setResults,
  setSearchBusy,
  requestModalItem,
  setRequestModalItem,
  selectedSeasonNumbers,
  setSelectedSeasonNumbers,
  setRequestModalError,
  setNotice,
  setBusyKey,
  navigate,
}: MediaActionsInput) {
  let searchLoadToken = 0;
  let searchLoadInvalidated = false;
  let recentRequestsLoadToken = 0;
  let requestPageLoadToken = 0;

  async function loadRecentRequests() {
    const token = ++recentRequestsLoadToken;
    if (!currentUser()) {
      setRecentRequests([]);
      return;
    }

    const params = new URLSearchParams({ limit: String(recentRequestLimit) });
    const data = await api<MediaRequestPage>(`/api/requests?${params}`);
    if (token === recentRequestsLoadToken) {
      setRecentRequests(data.requests);
    }
  }

  async function loadRequestPage() {
    const token = ++requestPageLoadToken;
    const user = currentUser();
    if (!user) {
      setRequests([]);
      setRequestTotal(0);
      setRequestPage(1);
      setRequestUserFilter(undefined);
      setRequestsBusy(false);
      return;
    }

    const requestedPage = requestPage();
    const params = new URLSearchParams({
      limit: String(requestPageSize),
      offset: String((requestedPage - 1) * requestPageSize),
    });
    const requestedByUserId = requestUserFilter();
    if (user.isAdministrator && requestedByUserId) {
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

      setRequests(data.requests);
      setRequestTotal(data.total);
    } catch (error) {
      if (token === requestPageLoadToken) {
        setNotice(messageFor(error), "error");
      }
    } finally {
      if (token === requestPageLoadToken) {
        setRequestsBusy(false);
      }
    }
  }

  async function loadRequests() {
    if (!currentUser()) {
      await Promise.all([loadRecentRequests(), loadRequestPage()]);
      return;
    }

    if (route().page === "requests") {
      await Promise.all([loadRecentRequests(), loadRequestPage()]);
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
