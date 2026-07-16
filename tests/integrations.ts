import { describe, expect, test } from "bun:test";

import { arr, db, http, jellyfin, jsonResponse, requestOwner } from "./support";

describe("outbound HTTP", () => {
  test("turns failed outbound connections into gateway errors", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    let error: unknown;
    try {
      await http.fetchWithTimeout("Offline service", "http://offline.test");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Offline service request failed.");
    expect((error as { status?: number }).status).toBe(502);
  });

  test("turns timed out requests into gateway errors", async () => {
    globalThis.fetch = (async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      })) as typeof fetch;

    let error: unknown;
    try {
      await http.fetchWithTimeout("Slow service", "http://slow.test", {}, 1);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Slow service request timed out.");
    expect((error as { status?: number }).status).toBe(504);
  });
});

describe("arr integrations", () => {
  test("preserves Radarr URL base paths", async () => {
    const urls: string[] = [];
    const requestBodies: Record<string, unknown>[] = [];

    db.saveIntegrationSettings({
      radarrUrl: "http://radarr.test/radarr",
      radarrApiKey: "radarr-key",
      radarrRootFolderPath: "/movies",
      radarrQualityProfileId: 1,
    });

    globalThis.fetch = (async (url, init) => {
      urls.push(String(url));

      if (String(url).endsWith("/api/v3/movie?tmdbId=123")) {
        return jsonResponse([]);
      }

      if (String(url).endsWith("/api/v3/movie/lookup/tmdb?tmdbId=123")) {
        return jsonResponse({ title: "Movie", tmdbId: 123 });
      }

      expect(init?.method).toBe("POST");
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return String(url).endsWith("/api/v3/movie")
        ? jsonResponse({ id: 10, titleSlug: "movie-123" })
        : jsonResponse({ id: 99 });
    }) as typeof fetch;

    await arr.submitMovieToRadarr(123);

    expect(urls).toEqual([
      "http://radarr.test/radarr/api/v3/movie?tmdbId=123",
      "http://radarr.test/radarr/api/v3/movie/lookup/tmdb?tmdbId=123",
      "http://radarr.test/radarr/api/v3/movie",
      "http://radarr.test/radarr/api/v3/command",
    ]);
    expect(requestBodies[0]?.monitored).toBe(true);
    expect(requestBodies[0]?.addOptions).toEqual({
      monitor: "movieOnly",
      searchForMovie: false,
    });
    expect(requestBodies[1]).toEqual({ name: "MoviesSearch", movieIds: [10] });
  });

  test("monitors and searches an existing Radarr movie", async () => {
    const requestBodies: Record<string, unknown>[] = [];

    db.saveIntegrationSettings({
      radarrUrl: "http://radarr-existing.test",
      radarrApiKey: "radarr-key",
      radarrRootFolderPath: "/movies",
      radarrQualityProfileId: 1,
    });

    globalThis.fetch = (async (url, init) => {
      if (String(url).endsWith("/api/v3/movie?tmdbId=124")) {
        return jsonResponse([
          {
            id: 11,
            title: "Existing Movie",
            titleSlug: "existing-movie",
            tmdbId: 124,
            monitored: false,
            hasFile: false,
          },
        ]);
      }

      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (String(url).endsWith("/api/v3/movie/11")) {
        expect(init?.method).toBe("PUT");
        return jsonResponse({ id: 11, titleSlug: "existing-movie", monitored: true });
      }

      expect(String(url)).toBe("http://radarr-existing.test/api/v3/command");
      expect(init?.method).toBe("POST");
      return jsonResponse({ id: 99 });
    }) as typeof fetch;

    await arr.submitMovieToRadarr(124);

    expect(requestBodies).toEqual([
      {
        id: 11,
        title: "Existing Movie",
        titleSlug: "existing-movie",
        tmdbId: 124,
        monitored: true,
        hasFile: false,
      },
      { name: "MoviesSearch", movieIds: [11] },
    ]);
  });

  test("discovers Radarr quality profiles and root folders", async () => {
    const urls: string[] = [];
    const apiKeys: (string | null)[] = [];

    db.saveIntegrationSettings({
      radarrUrl: "http://radarr.test/radarr",
      radarrApiKey: "radarr-key",
    });

    globalThis.fetch = (async (url, init) => {
      urls.push(String(url));
      apiKeys.push(new Headers(init?.headers).get("X-Api-Key"));

      if (String(url).endsWith("/api/v3/qualityprofile")) {
        return jsonResponse([
          { id: 1, name: "HD" },
          { id: "bad", name: "Broken" },
        ]);
      }

      if (String(url).endsWith("/api/v3/rootfolder")) {
        return jsonResponse([{ path: "/movies", freeSpace: 1024 }, { path: "" }]);
      }

      throw new Error(`Unexpected URL: ${String(url)}`);
    }) as typeof fetch;

    const options = await arr.getArrOptions("radarr");

    expect(urls).toEqual([
      "http://radarr.test/radarr/api/v3/qualityprofile",
      "http://radarr.test/radarr/api/v3/rootfolder",
    ]);
    expect(apiKeys).toEqual(["radarr-key", "radarr-key"]);
    expect(options).toEqual({
      qualityProfiles: [{ id: 1, name: "HD" }],
      rootFolders: [{ path: "/movies", freeSpace: 1024 }],
    });
  });

  test("preserves Sonarr URL base paths", async () => {
    const urls: string[] = [];
    const requestBodies: Record<string, unknown>[] = [];

    db.saveIntegrationSettings({
      tmdbToken: "tmdb-token",
      sonarrUrl: "http://sonarr.test/sonarr",
      sonarrApiKey: "sonarr-key",
      sonarrRootFolderPath: "/tv",
      sonarrQualityProfileId: 1,
    });

    globalThis.fetch = (async (url, init) => {
      urls.push(String(url));

      if (
        String(url) ===
        "https://api.themoviedb.org/3/tv/456?append_to_response=external_ids%2Ckeywords"
      ) {
        return jsonResponse({
          id: 456,
          name: "Series",
          external_ids: { id: 456, tvdb_id: 789 },
        });
      }

      if (String(url).endsWith("/api/v3/series?tvdbId=789")) {
        return jsonResponse([]);
      }

      if (String(url).endsWith("/api/v3/series/lookup?term=tvdb%3A789")) {
        return jsonResponse([{ title: "Series", tvdbId: 789, seasons: [{ seasonNumber: 1 }] }]);
      }

      expect(init?.method).toBe("POST");
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return String(url).endsWith("/api/v3/series")
        ? jsonResponse({ id: 20, titleSlug: "series-789" })
        : jsonResponse({ id: 99 });
    }) as typeof fetch;

    await arr.submitSeriesToSonarr(456, undefined);

    expect(urls).toEqual([
      "https://api.themoviedb.org/3/tv/456?append_to_response=external_ids%2Ckeywords",
      "http://sonarr.test/sonarr/api/v3/series?tvdbId=789",
      "http://sonarr.test/sonarr/api/v3/series/lookup?term=tvdb%3A789",
      "http://sonarr.test/sonarr/api/v3/series",
      "http://sonarr.test/sonarr/api/v3/command",
    ]);
    expect(requestBodies[0]?.monitored).toBe(true);
    expect(requestBodies[0]?.addOptions).toEqual({ searchForMissingEpisodes: false });
    expect(requestBodies[1]).toEqual({ name: "SeriesSearch", seriesId: 20 });
  });

  test("submits selected Sonarr seasons as monitored", async () => {
    let requestBody: Record<string, unknown> | undefined;
    let commandBody: Record<string, unknown> | undefined;

    db.saveIntegrationSettings({
      tmdbToken: "tmdb-token",
      sonarrUrl: "http://sonarr-selected.test",
      sonarrApiKey: "sonarr-key",
      sonarrRootFolderPath: "/tv",
      sonarrQualityProfileId: 1,
    });

    globalThis.fetch = (async (url, init) => {
      if (
        String(url) ===
        "https://api.themoviedb.org/3/tv/457?append_to_response=external_ids%2Ckeywords"
      ) {
        return jsonResponse({
          id: 457,
          name: "Selected Series",
          external_ids: { id: 457, tvdb_id: 790 },
        });
      }

      if (String(url).endsWith("/api/v3/series?tvdbId=790")) {
        return jsonResponse([]);
      }

      if (String(url).endsWith("/api/v3/series/lookup?term=tvdb%3A790")) {
        return jsonResponse([
          {
            title: "Selected Series",
            tvdbId: 790,
            seasons: [{ seasonNumber: 0 }, { seasonNumber: 1 }, { seasonNumber: 2 }],
          },
        ]);
      }

      expect(init?.method).toBe("POST");
      if (String(url).endsWith("/api/v3/series")) {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ id: 21, titleSlug: "selected-series" });
      }

      expect(String(url)).toBe("http://sonarr-selected.test/api/v3/command");
      commandBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ id: 99 });
    }) as typeof fetch;

    await arr.submitSeriesToSonarr(457, [2]);

    expect(requestBody?.monitored).toBe(true);
    expect(requestBody?.addOptions).toEqual({ searchForMissingEpisodes: false });
    expect(requestBody?.seasons).toEqual([
      { seasonNumber: 0, monitored: false },
      { seasonNumber: 1, monitored: false },
      { seasonNumber: 2, monitored: true },
    ]);
    expect(commandBody).toEqual({ name: "SeasonSearch", seriesId: 21, seasonNumber: 2 });
  });

  test("updates existing Sonarr series when later seasons are requested", async () => {
    const requestBodies: Record<string, unknown>[] = [];

    db.saveIntegrationSettings({
      tmdbToken: "tmdb-token",
      sonarrUrl: "http://sonarr-existing.test",
      sonarrApiKey: "sonarr-key",
      sonarrRootFolderPath: "/tv",
      sonarrQualityProfileId: 1,
    });

    globalThis.fetch = (async (url, init) => {
      if (
        String(url) ===
        "https://api.themoviedb.org/3/tv/458?append_to_response=external_ids%2Ckeywords"
      ) {
        return jsonResponse({
          id: 458,
          name: "Existing Series",
          external_ids: { id: 458, tvdb_id: 791 },
        });
      }

      if (String(url).endsWith("/api/v3/series?tvdbId=791")) {
        return jsonResponse([
          {
            id: 22,
            title: "Existing Series",
            titleSlug: "existing-series",
            tvdbId: 791,
            seasons: [
              { seasonNumber: 1, monitored: true },
              { seasonNumber: 2, monitored: false },
            ],
          },
        ]);
      }

      if (String(url).endsWith("/api/v3/series/22")) {
        expect(init?.method).toBe("PUT");
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({ id: 22, titleSlug: "existing-series" });
      }

      if (String(url).endsWith("/api/v3/command")) {
        expect(init?.method).toBe("POST");
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({ id: 99 });
      }

      throw new Error(`Unexpected URL: ${String(url)}`);
    }) as typeof fetch;

    await arr.submitSeriesToSonarr(458, [1, 2]);

    expect(requestBodies).toEqual([
      {
        id: 22,
        title: "Existing Series",
        titleSlug: "existing-series",
        tvdbId: 791,
        monitored: true,
        seasons: [
          { seasonNumber: 1, monitored: true },
          { seasonNumber: 2, monitored: true },
        ],
      },
      { name: "SeasonSearch", seriesId: 22, seasonNumber: 2 },
    ]);
  });

  test("uses the optional Sonarr anime root for Japanese animation", async () => {
    let requestBody: Record<string, unknown> | undefined;

    db.saveIntegrationSettings({
      tmdbToken: "tmdb-token",
      sonarrUrl: "http://sonarr-anime.test",
      sonarrApiKey: "sonarr-key",
      sonarrRootFolderPath: "/tv",
      sonarrAnimeRootFolderPath: "/anime",
      sonarrQualityProfileId: 1,
    });

    globalThis.fetch = (async (url, init) => {
      if (
        String(url) ===
        "https://api.themoviedb.org/3/tv/459?append_to_response=external_ids%2Ckeywords"
      ) {
        return jsonResponse({
          id: 459,
          name: "Anime Series",
          original_language: "ja",
          origin_country: ["JP"],
          genres: [{ id: 16, name: "Animation" }],
          external_ids: { id: 459, tvdb_id: 792 },
        });
      }

      if (String(url).endsWith("/api/v3/series?tvdbId=792")) {
        return jsonResponse([]);
      }

      if (String(url).endsWith("/api/v3/series/lookup?term=tvdb%3A792")) {
        return jsonResponse([
          {
            title: "Anime Series",
            tvdbId: 792,
            seasons: [{ seasonNumber: 1 }],
          },
        ]);
      }

      expect(init?.method).toBe("POST");
      if (String(url).endsWith("/api/v3/series")) {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ id: 23, titleSlug: "anime-series" });
      }

      expect(String(url)).toBe("http://sonarr-anime.test/api/v3/command");
      return jsonResponse({ id: 99 });
    }) as typeof fetch;

    await arr.submitSeriesToSonarr(459, [1]);

    expect(requestBody?.rootFolderPath).toBe("/anime");
    expect(requestBody?.qualityProfileId).toBe(1);
  });

  test("discovers Sonarr quality profiles and root folders", async () => {
    const urls: string[] = [];

    db.saveIntegrationSettings({
      sonarrUrl: "http://sonarr.test/sonarr",
      sonarrApiKey: "sonarr-key",
    });

    globalThis.fetch = (async (url, init) => {
      urls.push(String(url));
      expect(new Headers(init?.headers).get("X-Api-Key")).toBe("sonarr-key");

      if (String(url).endsWith("/api/v3/qualityprofile")) {
        return jsonResponse([{ id: 2, name: "HD - 1080p" }]);
      }

      if (String(url).endsWith("/api/v3/rootfolder")) {
        return jsonResponse([{ path: "/tv" }]);
      }

      throw new Error(`Unexpected URL: ${String(url)}`);
    }) as typeof fetch;

    const options = await arr.getArrOptions("sonarr");

    expect(urls).toEqual([
      "http://sonarr.test/sonarr/api/v3/qualityprofile",
      "http://sonarr.test/sonarr/api/v3/rootfolder",
    ]);
    expect(options).toEqual({
      qualityProfiles: [{ id: 2, name: "HD - 1080p" }],
      rootFolders: [{ path: "/tv" }],
    });
  });
});

describe("jellyfin auth", () => {
  test("maps successful Jellyfin login responses", async () => {
    db.saveIntegrationSettings({
      jellyfinUrl: "http://jellyfin.test",
    });

    let requestBody: unknown;

    globalThis.fetch = (async (url, init) => {
      expect(String(url)).toBe("http://jellyfin.test/Users/AuthenticateByName");
      requestBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          AccessToken: "access-token",
          User: {
            Id: "jf-user-2",
            Name: "jelly-user",
            Policy: {
              IsAdministrator: true,
            },
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    const login = await jellyfin.authenticateJellyfin("jelly-user", "secret");

    expect(requestBody).toEqual({
      Username: "jelly-user",
      Pw: "secret",
    });
    expect(login).toEqual({
      user: {
        jellyfinUserId: "jf-user-2",
        name: "jelly-user",
        isAdministrator: true,
      },
    });
  });

  test("discovers supported Jellyfin libraries with an API key", async () => {
    db.saveIntegrationSettings({
      jellyfinUrl: "http://jellyfin-libraries.test",
      jellyfinApiKey: "library-api-key",
    });

    globalThis.fetch = (async (url, init) => {
      expect(String(url)).toBe("http://jellyfin-libraries.test/Library/VirtualFolders");
      expect(new Headers(init?.headers).get("X-Emby-Token")).toBe("library-api-key");

      return jsonResponse([
        { ItemId: "movies", Name: "Movies", CollectionType: "movies" },
        { ItemId: "series", Name: "Series", CollectionType: "tvshows" },
        { ItemId: "mixed", Name: "Mixed", CollectionType: "mixed" },
        { ItemId: "music", Name: "Music", CollectionType: "music" },
        { ItemId: "books", Name: "Books", CollectionType: "books" },
        { ItemId: "unknown", Name: "Unknown" },
        { ItemId: "", Name: "Broken" },
      ]);
    }) as typeof fetch;

    const libraries = await jellyfin.getJellyfinLibraries();

    expect(libraries).toEqual([
      { id: "movies", name: "Movies", collectionType: "movies" },
      { id: "series", name: "Series", collectionType: "tvshows" },
      { id: "mixed", name: "Mixed", collectionType: "mixed" },
    ]);
  });

  test("syncs Jellyfin availability from supported libraries", async () => {
    db.saveIntegrationSettings({
      jellyfinUrl: "http://jellyfin-sync.test",
      jellyfinApiKey: "sync-api-key",
    });

    const requestedParents: string[] = [];

    globalThis.fetch = (async (url, init) => {
      expect(new Headers(init?.headers).get("X-Emby-Token")).toBe("sync-api-key");

      const requestUrl = new URL(String(url));

      if (requestUrl.pathname === "/Library/VirtualFolders") {
        return jsonResponse([
          { ItemId: "movies", Name: "Movies", CollectionType: "movies" },
          { ItemId: "series", Name: "Series", CollectionType: "tvshows" },
          { ItemId: "mixed", Name: "Mixed", CollectionType: "mixed" },
          { ItemId: "music", Name: "Music", CollectionType: "music" },
        ]);
      }

      requestedParents.push(requestUrl.searchParams.get("ParentId") ?? "");

      if (requestUrl.searchParams.get("ParentId") === "movies") {
        return jsonResponse({
          Items: [
            {
              Id: "movie-item",
              Name: "Available Movie",
              Type: "Movie",
              ProviderIds: { Tmdb: "9101" },
            },
            {
              Id: "movie-without-tmdb",
              Name: "No TMDB",
              Type: "Movie",
              ProviderIds: {},
            },
          ],
        });
      }

      if (requestUrl.searchParams.get("ParentId") === "mixed") {
        return jsonResponse({
          Items: [
            {
              Id: "mixed-movie-item",
              Name: "Mixed Available Movie",
              Type: "Movie",
              ProviderIds: { Tmdb: "9103" },
            },
          ],
        });
      }

      return jsonResponse({
        Items: [
          {
            Id: "series-item",
            Name: "Available Series",
            Type: "Series",
            ProviderIds: { Tmdb: "9102" },
          },
          {
            Id: "series-season-1",
            Name: "Season 1",
            Type: "Season",
            IndexNumber: 1,
            SeriesId: "series-item",
          },
        ],
      });
    }) as typeof fetch;

    const result = await jellyfin.syncJellyfinAvailability();

    expect(requestedParents).toEqual(["movies", "series", "mixed"]);
    expect(result).toEqual({ availableCount: 3 });
    const seriesRequest = db.createRequest({
      mediaType: "tv",
      tmdbId: 9102,
      title: "Available Series",
      ...requestOwner("sync-test"),
      seasonNumbers: [1, 2],
    });
    expect(seriesRequest.availability).toBe("requested");
    expect(seriesRequest.availableSeasonNumbers).toEqual([1]);
    expect(() =>
      db.createRequest({
        mediaType: "movie",
        tmdbId: 9101,
        title: "Available Movie",
        ...requestOwner("sync-test"),
      }),
    ).toThrow("This title is already available.");
  });
});
