import { describe, expect, test } from "bun:test";

import {
  apiRequest,
  apiServer,
  cookies,
  createRouteTestSessions,
  db,
  expectSecurityHeaders,
  jsonResponse,
  requestSecurity,
  staticServer,
} from "./support";

describe("api access control", () => {
  test("keeps health public and admin settings admin-only", async () => {
    const { adminSession, userSession } = createRouteTestSessions("settings-access");

    const health = await apiRequest("/api/health");
    expect(health.status).toBe(200);
    expectSecurityHeaders(health);
    expect(health.headers.get("Cache-Control")).toBe("no-store");
    expect(await health.json()).toMatchObject({ ok: true, setupRequired: false });

    const anonymousSettings = await apiRequest("/api/admin/settings");
    expect(anonymousSettings.status).toBe(401);
    expectSecurityHeaders(anonymousSettings);

    const userSettings = await apiRequest("/api/admin/settings", userSession.token);
    expect(userSettings.status).toBe(403);

    const adminSettings = await apiRequest("/api/admin/settings", adminSession.token);
    expect(adminSettings.status).toBe(200);
    expect(await adminSettings.json()).toHaveProperty("settings");
  });

  test("creates, resolves, and revokes a Jellyfin login session", async () => {
    db.completeSetup();
    db.saveIntegrationSettings({ jellyfinUrl: "http://jellyfin-auth-route.test" });

    globalThis.fetch = (async (url, init) => {
      expect(String(url)).toBe("http://jellyfin-auth-route.test/Users/AuthenticateByName");
      expect(JSON.parse(String(init?.body))).toEqual({
        Username: "route-login-user",
        Pw: "route-login-password",
      });

      return jsonResponse({
        AccessToken: "jellyfin-access-token",
        User: {
          Id: "jf-route-login-user",
          Name: "route-login-user",
          Policy: { IsAdministrator: false },
        },
      });
    }) as typeof fetch;

    const login = await apiRequest("/api/auth/jellyfin", undefined, "POST", {
      username: "route-login-user",
      password: "route-login-password",
    });
    expect(login.status).toBe(200);
    expect(login.headers.get("Cache-Control")).toBe("no-store");
    expect(await login.json()).toEqual({
      user: expect.objectContaining({
        jellyfinUserId: "jf-route-login-user",
        name: "route-login-user",
        isAdministrator: false,
      }),
    });

    const setCookie = login.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`${cookies.sessionCookieName}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    const sessionToken = decodeURIComponent(
      setCookie.match(new RegExp(`${cookies.sessionCookieName}=([^;]+)`))?.[1] ?? "",
    );
    expect(sessionToken).not.toBe("");

    const me = await apiRequest("/api/auth/me", sessionToken);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      user: expect.objectContaining({ jellyfinUserId: "jf-route-login-user" }),
    });

    const logout = await apiRequest("/api/auth/logout", sessionToken, "POST");
    expect(logout.status).toBe(200);
    expect(logout.headers.get("Cache-Control")).toBe("no-store");
    expect(await logout.json()).toEqual({ ok: true });
    expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");

    const meAfterLogout = await apiRequest("/api/auth/me", sessionToken);
    expect(meAfterLogout.status).toBe(200);
    expect(await meAfterLogout.json()).toEqual({ user: null });
  });

  test("requires JSON request bodies and rejects oversized payloads", async () => {
    const wrongContentType = await apiRequest("/api/auth/jellyfin", undefined, "POST", undefined, {
      "Content-Type": "text/plain",
    });
    expect(wrongContentType.status).toBe(415);
    expect(wrongContentType.headers.get("Cache-Control")).toBe("no-store");
    expect(await wrongContentType.json()).toEqual({
      error: "Expected an application/json request body.",
    });

    const oversized = await apiRequest("/api/auth/jellyfin", undefined, "POST", {
      username: "x".repeat(apiServer.maxRequestBodyBytes),
      password: "password",
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: "Request body is too large." });
  });

  test("bounds searches and stored request metadata", async () => {
    const { userSession } = createRouteTestSessions("request-limits");

    const search = await apiRequest(
      `/api/search?q=${encodeURIComponent("x".repeat(201))}&type=multi`,
      userSession.token,
    );
    expect(search.status).toBe(400);
    expect(await search.json()).toEqual({ error: "Search query is too long." });

    const request = await apiRequest("/api/requests", userSession.token, "POST", {
      mediaType: "movie",
      tmdbId: 9000,
      title: "x".repeat(501),
    });
    expect(request.status).toBe(400);
    expect(await request.json()).toEqual({ error: "Title is too long." });
  });

  test("requires admins for admin endpoints", async () => {
    const { userSession } = createRouteTestSessions("admin-endpoints");
    const adminEndpoints = [
      { method: "POST", path: "/api/admin/jellyfin/sync" },
      { method: "GET", path: "/api/admin/users" },
      { method: "POST", path: "/api/admin/users/sync" },
      { method: "POST", path: "/api/admin/radarr/options" },
      { method: "POST", path: "/api/admin/sonarr/options" },
    ];

    for (const endpoint of adminEndpoints) {
      const anonymous = await apiRequest(endpoint.path, undefined, endpoint.method);
      expect(anonymous.status).toBe(401);

      const user = await apiRequest(endpoint.path, userSession.token, endpoint.method);
      expect(user.status).toBe(403);
    }
  });

  test("syncs Jellyfin users and removes departed local users", async () => {
    const { admin, adminSession } = createRouteTestSessions("admin-users-sync");
    const departed = db.upsertJellyfinUser({
      jellyfinUserId: "jf-departed-user",
      name: "Departed User",
      isAdministrator: false,
    });
    const departedRequest = db.createRequest({
      mediaType: "movie",
      tmdbId: 9051,
      title: "Departed User Request",
      requestedByUserId: departed.id,
    });
    const departedSession = db.createAuthSession(departed);
    db.saveIntegrationSettings({
      jellyfinUrl: "http://jellyfin-users.test",
      jellyfinApiKey: "users-api-key",
    });

    globalThis.fetch = (async (url, init) => {
      expect(String(url)).toBe("http://jellyfin-users.test/Users");
      expect(new Headers(init?.headers).get("X-Emby-Token")).toBe("users-api-key");

      return jsonResponse([
        {
          Id: admin.jellyfinUserId,
          Name: "Synced Admin",
          Policy: { IsAdministrator: true },
        },
        {
          Id: "jf-synced-user",
          Name: "Synced User",
          Policy: { IsAdministrator: false },
        },
        {
          Id: "",
          Name: "Broken User",
        },
      ]);
    }) as typeof fetch;

    const response = await apiRequest("/api/admin/users/sync", adminSession.token, "POST");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      syncedCount: number;
      removedCount: number;
      users: Array<{ jellyfinUserId: string; name: string; isAdministrator: boolean }>;
    };
    expect(body.syncedCount).toBe(2);
    expect(body.removedCount).toBeGreaterThanOrEqual(1);
    expect(body.users).toContainEqual(
      expect.objectContaining({
        jellyfinUserId: admin.jellyfinUserId,
        name: "Synced Admin",
        isAdministrator: true,
      }),
    );
    expect(body.users).toContainEqual(
      expect.objectContaining({
        jellyfinUserId: "jf-synced-user",
        name: "Synced User",
        isAdministrator: false,
      }),
    );
    expect(db.getUser(departed.id)).toBeUndefined();
    expect(db.getRequest(departedRequest.id)).toBeUndefined();
    expect(db.getAuthSession(departedSession.token)).toBeUndefined();
  });

  test("saves admin settings without returning secrets or stale summaries", async () => {
    const { adminSession } = createRouteTestSessions("admin-settings-save");
    db.saveIntegrationSettings({
      tmdbToken: "saved-admin-save-tmdb-token",
      jellyfinApiKey: "saved-admin-save-jellyfin-key",
      radarrApiKey: "saved-admin-save-radarr-key",
      sonarrApiKey: "saved-admin-save-sonarr-key",
    });

    const response = await apiRequest("/api/admin/settings", adminSession.token, "PUT", {
      publicOrigin: "https://cove-admin-save.test/path",
      jellyfinUrl: "http://jellyfin-admin-save.test/",
      jellyfinApiKey: "",
      tmdbToken: "",
      radarrUrl: "http://radarr-admin-save.test/radarr/",
      radarrApiKey: "",
      radarrRootFolderPath: "/admin-save-movies",
      radarrQualityProfileId: "8",
      sonarrUrl: "http://sonarr-admin-save.test/sonarr/",
      sonarrApiKey: "",
      sonarrRootFolderPath: "/admin-save-tv",
      sonarrAnimeRootFolderPath: "/admin-save-anime",
      sonarrQualityProfileId: "9",
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      settings: unknown;
      summary?: unknown;
    };
    expect("summary" in body).toBe(false);
    expect(body.settings).toEqual({
      app: {
        publicOrigin: "https://cove-admin-save.test",
      },
      tmdb: {
        tokenConfigured: true,
      },
      jellyfin: {
        url: "http://jellyfin-admin-save.test",
        apiKeyConfigured: true,
      },
      radarr: {
        url: "http://radarr-admin-save.test/radarr",
        apiKeyConfigured: true,
        rootFolderPath: "/admin-save-movies",
        qualityProfileId: 8,
      },
      sonarr: {
        url: "http://sonarr-admin-save.test/sonarr",
        apiKeyConfigured: true,
        rootFolderPath: "/admin-save-tv",
        animeRootFolderPath: "/admin-save-anime",
        qualityProfileId: 9,
      },
    });

    const saved = db.getIntegrationSettings();
    expect(saved.tmdb.token).toBe("saved-admin-save-tmdb-token");
    expect(saved.jellyfin.apiKey).toBe("saved-admin-save-jellyfin-key");
    expect(saved.radarr.apiKey).toBe("saved-admin-save-radarr-key");
    expect(saved.sonarr.apiKey).toBe("saved-admin-save-sonarr-key");
  });

  test("loads Arr options from current form connection values", async () => {
    const { adminSession } = createRouteTestSessions("arr-options-probe");
    db.saveIntegrationSettings({
      radarrUrl: "http://radarr-saved.test",
      radarrApiKey: "saved-radarr-key",
    });

    const seenUrls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      seenUrls.push(String(url));
      expect(new Headers(init?.headers).get("X-Api-Key")).toBe("form-radarr-key");

      if (String(url).endsWith("/api/v3/qualityprofile")) {
        return jsonResponse([{ id: 9, name: "Probe HD" }]);
      }

      if (String(url).endsWith("/api/v3/rootfolder")) {
        return jsonResponse([{ path: "/probe-movies" }]);
      }

      throw new Error(`Unexpected URL: ${String(url)}`);
    }) as typeof fetch;

    const response = await apiRequest("/api/admin/radarr/options", adminSession.token, "POST", {
      url: "http://radarr-form.test",
      apiKey: "form-radarr-key",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      options: {
        qualityProfiles: [{ id: 9, name: "Probe HD" }],
        rootFolders: [{ path: "/probe-movies" }],
      },
    });
    expect(seenUrls).toEqual([
      "http://radarr-form.test/api/v3/qualityprofile",
      "http://radarr-form.test/api/v3/rootfolder",
    ]);
  });

  test("only exposes a user's requests while admins can see all requests", async () => {
    const { adminSession, user, userSession } = createRouteTestSessions("request-access");
    const otherUser = db.upsertJellyfinUser({
      jellyfinUserId: "jf-request-access-other",
      name: "request-access-other",
      isAdministrator: false,
    });
    const ownRequest = db.createRequest({
      mediaType: "movie",
      tmdbId: 9001,
      title: "Route Request Access",
      requestedByUserId: user.id,
    });
    const otherRequest = db.createRequest({
      mediaType: "movie",
      tmdbId: 9002,
      title: "Other User Route Request",
      requestedByUserId: otherUser.id,
    });

    const anonymous = await apiRequest("/api/requests");
    expect(anonymous.status).toBe(401);

    const userResponse = await apiRequest("/api/requests", userSession.token);
    expect(userResponse.status).toBe(200);
    const userBody = (await userResponse.json()) as {
      requests: Array<{ id: number }>;
      total: number;
    };
    expect(userBody.requests.map((request) => request.id)).toEqual([ownRequest.id]);
    expect(userBody.total).toBe(1);

    const ignoredUserFilter = await apiRequest(
      `/api/requests?requestedByUserId=${otherUser.id}`,
      userSession.token,
    );
    expect(await ignoredUserFilter.json()).toEqual({
      requests: [expect.objectContaining({ id: ownRequest.id })],
      total: 1,
    });

    const adminResponse = await apiRequest("/api/requests", adminSession.token);
    expect(adminResponse.status).toBe(200);
    const adminBody = (await adminResponse.json()) as {
      requests: Array<{ id: number }>;
      total: number;
    };
    expect(adminBody.requests.map((request) => request.id)).toContain(ownRequest.id);
    expect(adminBody.requests.map((request) => request.id)).toContain(otherRequest.id);
    expect(adminBody.total).toBeGreaterThanOrEqual(2);

    const filteredAdminResponse = await apiRequest(
      `/api/requests?requestedByUserId=${otherUser.id}&limit=1&offset=0`,
      adminSession.token,
    );
    expect(await filteredAdminResponse.json()).toEqual({
      requests: [expect.objectContaining({ id: otherRequest.id })],
      total: 1,
    });
  });

  test("validates request pagination parameters", async () => {
    const { adminSession } = createRouteTestSessions("request-page-validation");
    const invalidRequests = [
      ["/api/requests?limit=0", "Request limit must be between 1 and 100."],
      ["/api/requests?limit=101", "Request limit must be between 1 and 100."],
      ["/api/requests?offset=-1", "Request offset must be between 0 and 1000000."],
      ["/api/requests?requestedByUserId=none", "Requested user ID must be a positive integer."],
    ];

    for (const [path, error] of invalidRequests) {
      const response = await apiRequest(path, adminSession.token);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error });
    }
  });

  test("only lets request owners and admins remove requests", async () => {
    const { adminSession, user, userSession } = createRouteTestSessions("request-removal");
    const otherUser = db.upsertJellyfinUser({
      jellyfinUserId: "jf-request-removal-other",
      name: "request-removal-other",
      isAdministrator: false,
    });
    const otherUserSession = db.createAuthSession(otherUser);
    const ownerRequest = db.createRequest({
      mediaType: "movie",
      tmdbId: 9003,
      title: "Owner Removal Request",
      requestedByUserId: user.id,
    });
    const adminRemovalRequest = db.createRequest({
      mediaType: "movie",
      tmdbId: 9004,
      title: "Admin Removal Request",
      requestedByUserId: user.id,
    });

    const anonymous = await apiRequest(`/api/requests/${ownerRequest.id}`, undefined, "DELETE");
    expect(anonymous.status).toBe(401);
    expect(db.getRequest(ownerRequest.id)).toBeDefined();

    const unrelatedUser = await apiRequest(
      `/api/requests/${ownerRequest.id}`,
      otherUserSession.token,
      "DELETE",
    );
    expect(unrelatedUser.status).toBe(404);
    expect(db.getRequest(ownerRequest.id)).toBeDefined();

    const owner = await apiRequest(`/api/requests/${ownerRequest.id}`, userSession.token, "DELETE");
    expect(owner.status).toBe(200);
    expect(db.getRequest(ownerRequest.id)).toBeUndefined();

    const admin = await apiRequest(
      `/api/requests/${adminRemovalRequest.id}`,
      adminSession.token,
      "DELETE",
    );
    expect(admin.status).toBe(200);
    expect(db.getRequest(adminRemovalRequest.id)).toBeUndefined();
  });

  test("proxies Jellyfin user avatars through account visibility rules", async () => {
    const { admin, adminSession, user, userSession } = createRouteTestSessions("avatar-access");
    db.saveIntegrationSettings({
      jellyfinUrl: "http://jellyfin-avatar.test",
      jellyfinApiKey: "avatar-key",
    });

    const seenUrls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      seenUrls.push(String(url));

      const headers = new Headers(init?.headers);
      expect(headers.get("X-Emby-Token")).toBe("avatar-key");
      expect(headers.get("Accept")).toBe("image/*");

      return new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "Content-Type": "image/png",
        },
      });
    }) as typeof fetch;

    const anonymous = await apiRequest(`/api/users/${user.id}/avatar`);
    expect(anonymous.status).toBe(401);

    const otherUser = await apiRequest(`/api/users/${admin.id}/avatar`, userSession.token);
    expect(otherUser.status).toBe(404);

    const ownAvatar = await apiRequest(`/api/users/${user.id}/avatar`, userSession.token);
    expect(ownAvatar.status).toBe(200);
    expectSecurityHeaders(ownAvatar);
    expect(ownAvatar.headers.get("Content-Type")).toBe("image/png");
    expect(ownAvatar.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(Array.from(new Uint8Array(await ownAvatar.arrayBuffer()))).toEqual([1, 2, 3]);

    const adminAvatar = await apiRequest(`/api/users/${user.id}/avatar`, adminSession.token);
    expect(adminAvatar.status).toBe(200);

    expect(seenUrls).toEqual([
      "http://jellyfin-avatar.test/Users/jf-avatar-access-user/Images/Primary?maxWidth=96&maxHeight=96&quality=90",
      "http://jellyfin-avatar.test/Users/jf-avatar-access-user/Images/Primary?maxWidth=96&maxHeight=96&quality=90",
    ]);
  });

  test("rejects unsupported proxied Jellyfin avatar image types", async () => {
    const { user, userSession } = createRouteTestSessions("avatar-content-type");
    db.saveIntegrationSettings({
      jellyfinUrl: "http://jellyfin-avatar-type.test",
      jellyfinApiKey: "avatar-type-key",
    });

    globalThis.fetch = (async (_url, _init) =>
      new Response("<svg></svg>", {
        headers: {
          "Content-Type": "image/svg+xml",
        },
      })) as typeof fetch;

    const response = await apiRequest(`/api/users/${user.id}/avatar`, userSession.token);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Jellyfin returned an unsupported avatar image type.",
    });
  });

  test("annotates search results with availability", async () => {
    const { user, userSession } = createRouteTestSessions("search-availability");
    db.upsertAvailableMedia(
      [
        {
          mediaType: "movie",
          tmdbId: 9002,
          jellyfinItemId: "jf-available-movie",
        },
        {
          mediaType: "tv",
          tmdbId: 9003,
          jellyfinItemId: "jf-season-series",
        },
      ],
      [
        {
          tmdbId: 9003,
          seasonNumber: 1,
        },
      ],
    );
    db.createRequest({
      mediaType: "movie",
      tmdbId: 9004,
      title: "Requested Movie",
      requestedByUserId: user.id,
    });

    globalThis.fetch = (async (url) => {
      expect(String(url)).toBe(
        "https://api.themoviedb.org/3/search/multi?query=availability&include_adult=false",
      );

      return jsonResponse({
        results: [
          { id: 9002, media_type: "movie", title: "Available Movie" },
          { id: 9003, media_type: "tv", name: "Season Series" },
          { id: 9004, media_type: "movie", title: "Requested Movie" },
          { id: 9007, media_type: "movie", title: "Missing Movie" },
        ],
      });
    }) as typeof fetch;

    const response = await apiRequest("/api/search?q=availability&type=multi", userSession.token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: Array<{
        tmdbId: number;
        availability?: string;
        availableSeasonNumbers?: number[];
      }>;
    };

    expect(body.results).toMatchObject([
      { tmdbId: 9002, availability: "available" },
      { tmdbId: 9003, availability: "available", availableSeasonNumbers: [1] },
      { tmdbId: 9004, availability: "requested" },
      { tmdbId: 9007 },
    ]);
    const unavailable = body.results.find((result) => result.tmdbId === 9007);
    expect(unavailable).toBeDefined();
    expect(unavailable).not.toHaveProperty("availability");
  });

  test("redirects available media to Jellyfin details", async () => {
    const { userSession } = createRouteTestSessions("jellyfin-media-link");
    db.saveIntegrationSettings({
      jellyfinUrl: "https://watch.example",
    });
    db.replaceAvailableMedia([
      {
        mediaType: "movie",
        tmdbId: 99010,
        jellyfinItemId: "jf-available-link",
      },
    ]);

    const anonymous = await apiRequest("/api/media/movie/99010/jellyfin");
    expect(anonymous.status).toBe(401);

    const unavailable = await apiRequest("/api/media/movie/99011/jellyfin", userSession.token);
    expect(unavailable.status).toBe(404);

    const response = await apiRequest("/api/media/movie/99010/jellyfin", userSession.token);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://watch.example/web/index.html#!/details?id=jf-available-link",
    );
    expectSecurityHeaders(response);
  });

  test("redirects request owners and admins to stored Arr media details", async () => {
    const { user, adminSession, userSession } = createRouteTestSessions("arr-link");
    const otherUser = db.upsertJellyfinUser({
      jellyfinUserId: "jf-arr-link-other",
      name: "arr-link-other",
      isAdministrator: false,
    });
    const otherSession = db.createAuthSession(otherUser);

    db.saveIntegrationSettings({
      radarrUrl: "http://radarr-link.test/radarr",
      radarrApiKey: "radarr-link-key",
      sonarrUrl: "http://sonarr-link.test/sonarr",
      sonarrApiKey: "sonarr-link-key",
    });
    db.createRequest({
      mediaType: "movie",
      tmdbId: 9050,
      title: "Managed Movie",
      requestedByUserId: user.id,
    });
    db.createRequest({
      mediaType: "tv",
      tmdbId: 9051,
      title: "Managed Series",
      requestedByUserId: user.id,
    });
    db.createRequest({
      mediaType: "movie",
      tmdbId: 9052,
      title: "Missing Arr Reference",
      requestedByUserId: user.id,
    });
    db.upsertArrMediaReference({
      mediaType: "movie",
      tmdbId: 9050,
      itemId: 50,
      titleSlug: "managed-movie",
    });
    db.upsertArrMediaReference({
      mediaType: "tv",
      tmdbId: 9051,
      itemId: 51,
      titleSlug: "managed-series",
    });

    const movie = await apiRequest("/api/media/movie/9050/arr", userSession.token);
    expect(movie.status).toBe(302);
    expect(movie.headers.get("Location")).toBe(
      "http://radarr-link.test/radarr/movie/managed-movie",
    );

    const series = await apiRequest("/api/media/tv/9051/arr", adminSession.token);
    expect(series.status).toBe(302);
    expect(series.headers.get("Location")).toBe(
      "http://sonarr-link.test/sonarr/series/managed-series",
    );

    const unrelated = await apiRequest("/api/media/movie/9050/arr", otherSession.token);
    expect(unrelated.status).toBe(404);
    const missingReference = await apiRequest("/api/media/movie/9052/arr", userSession.token);
    expect(missingReference.status).toBe(404);
    const anonymous = await apiRequest("/api/media/movie/9050/arr");
    expect(anonymous.status).toBe(401);
  });

  test("annotates TMDB details with availability", async () => {
    const { userSession } = createRouteTestSessions("details-availability");
    db.upsertAvailableMedia(
      [
        {
          mediaType: "tv",
          tmdbId: 9005,
          jellyfinItemId: "jf-details-series",
        },
      ],
      [
        {
          tmdbId: 9005,
          seasonNumber: 2,
        },
      ],
    );

    globalThis.fetch = (async (url) => {
      expect(String(url)).toBe("https://api.themoviedb.org/3/tv/9005");

      return jsonResponse({
        id: 9005,
        name: "Details Series",
        seasons: [
          { season_number: 1, name: "Season 1", episode_count: 8 },
          { season_number: 2, name: "Season 2", episode_count: 8 },
        ],
      });
    }) as typeof fetch;

    const response = await apiRequest("/api/tmdb/tv/9005", userSession.token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      item: {
        availability: string;
        availableSeasonNumbers?: number[];
      };
    };

    expect(body.item).toMatchObject({
      availability: "available",
      availableSeasonNumbers: [2],
    });
  });

  test("leaves unrequested TMDB details without availability", async () => {
    const { userSession } = createRouteTestSessions("details-unrequested");

    globalThis.fetch = (async (url) => {
      expect(String(url)).toBe("https://api.themoviedb.org/3/tv/9008");

      return jsonResponse({
        id: 9008,
        name: "Unrequested Series",
        seasons: [{ season_number: 1, name: "Season 1", episode_count: 8 }],
      });
    }) as typeof fetch;

    const response = await apiRequest("/api/tmdb/tv/9008", userSession.token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      item: {
        availability?: string;
      };
    };

    expect(body.item).not.toHaveProperty("availability");
  });

  test("submits the first media request and skips duplicate submissions", async () => {
    const { userSession } = createRouteTestSessions("auto-submit");
    const secondUser = db.upsertJellyfinUser({
      jellyfinUserId: "jf-auto-submit-second-user",
      name: "auto-submit-second-user",
      isAdministrator: false,
    });
    const secondUserSession = db.createAuthSession(secondUser);

    db.saveIntegrationSettings({
      radarrUrl: "http://radarr-route.test",
      radarrApiKey: "route-radarr-key",
      radarrRootFolderPath: "/movies",
      radarrQualityProfileId: 7,
    });

    let addCalls = 0;

    globalThis.fetch = (async (url, init) => {
      if (String(url).endsWith("/api/v3/movie?tmdbId=9010")) {
        return jsonResponse([]);
      }

      if (String(url).endsWith("/api/v3/movie/lookup/tmdb?tmdbId=9010")) {
        return jsonResponse({ title: "Route Auto Submit", tmdbId: 9010 });
      }

      expect(init?.method).toBe("POST");
      if (String(url).endsWith("/api/v3/command")) {
        return jsonResponse({ id: 9011 });
      }

      expect(String(url)).toBe("http://radarr-route.test/api/v3/movie");
      addCalls += 1;
      return jsonResponse({ id: 9010, titleSlug: "route-auto-submit" });
    }) as typeof fetch;

    const body = {
      mediaType: "movie",
      tmdbId: 9010,
      title: "Route Auto Submit",
    };

    const first = await apiRequest("/api/requests", userSession.token, "POST", body);
    expect(first.status).toBe(201);
    expect(db.getArrMediaReference("movie", 9010)).toEqual({
      mediaType: "movie",
      tmdbId: 9010,
      itemId: 9010,
      titleSlug: "route-auto-submit",
    });

    const second = await apiRequest("/api/requests", secondUserSession.token, "POST", body);
    expect(second.status).toBe(201);

    expect(addCalls).toBe(1);
    expect(
      db
        .listRequestsForMedia("movie", 9010)
        .map((request) => request.requestedBy)
        .sort(),
    ).toEqual(["auto-submit-second-user", "auto-submit-user"]);
  });

  test("hides upstream service error bodies from API responses", async () => {
    const { userSession } = createRouteTestSessions("upstream-error");

    db.saveIntegrationSettings({
      radarrUrl: "http://radarr-error.test",
      radarrApiKey: "route-radarr-secret",
      radarrRootFolderPath: "/movies",
      radarrQualityProfileId: 7,
    });

    globalThis.fetch = (async (url, init) => {
      if (String(url).endsWith("/api/v3/movie?tmdbId=9012")) {
        return jsonResponse([]);
      }

      if (String(url).endsWith("/api/v3/movie/lookup/tmdb?tmdbId=9012")) {
        return jsonResponse({ title: "Route Upstream Error", tmdbId: 9012 });
      }

      expect(String(url)).toBe("http://radarr-error.test/api/v3/movie");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ error: "Bad request", apiKey: "route-radarr-secret" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }) as typeof fetch;

    const response = await apiRequest("/api/requests", userSession.token, "POST", {
      mediaType: "movie",
      tmdbId: 9012,
      title: "Route Upstream Error",
    });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("Radarr returned 400.");
    expect(body).not.toContain("route-radarr-secret");
    expect(body).not.toContain("details");
    expect(db.listRequestsForMedia("movie", 9012)).toHaveLength(0);
  });

  test("syncs Sonarr when a later request adds seasons", async () => {
    const { user } = createRouteTestSessions("season-sync");
    const secondUser = db.upsertJellyfinUser({
      jellyfinUserId: "jf-season-sync-second-user",
      name: "season-sync-second-user",
      isAdministrator: false,
    });
    const secondUserSession = db.createAuthSession(secondUser);
    db.createRequest({
      mediaType: "tv",
      tmdbId: 9011,
      title: "Route Season Sync",
      requestedByUserId: user.id,
      seasonNumbers: [1],
    });
    db.saveIntegrationSettings({
      tmdbToken: "tmdb-token",
      sonarrUrl: "http://sonarr-route.test",
      sonarrApiKey: "route-sonarr-key",
      sonarrRootFolderPath: "/tv",
      sonarrQualityProfileId: 8,
    });

    const requestBodies: Record<string, unknown>[] = [];

    globalThis.fetch = (async (url, init) => {
      if (
        String(url) ===
        "https://api.themoviedb.org/3/tv/9011?append_to_response=external_ids%2Ckeywords"
      ) {
        return jsonResponse({
          id: 9011,
          name: "Route Season Sync",
          external_ids: { id: 9011, tvdb_id: 901101 },
        });
      }

      if (String(url).endsWith("/api/v3/series?tvdbId=901101")) {
        return jsonResponse([
          {
            id: 901101,
            title: "Route Season Sync",
            titleSlug: "route-season-sync",
            tvdbId: 901101,
            seasons: [
              { seasonNumber: 1, monitored: true },
              { seasonNumber: 2, monitored: false },
            ],
          },
        ]);
      }

      if (String(url).endsWith("/api/v3/series/901101")) {
        expect(init?.method).toBe("PUT");
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({ id: 901101, titleSlug: "route-season-sync" });
      }

      if (String(url).endsWith("/api/v3/command")) {
        expect(init?.method).toBe("POST");
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({ id: 901102 });
      }

      throw new Error(`Unexpected URL: ${String(url)}`);
    }) as typeof fetch;

    const response = await apiRequest("/api/requests", secondUserSession.token, "POST", {
      mediaType: "tv",
      tmdbId: 9011,
      title: "Route Season Sync",
      seasonNumbers: [2],
    });
    expect(response.status).toBe(201);

    const seasonNumbersByUser = new Map(
      db
        .listRequestsForMedia("tv", 9011)
        .map((request) => [request.requestedByUserId, request.seasonNumbers]),
    );
    expect(seasonNumbersByUser.get(user.id)).toEqual([1]);
    expect(seasonNumbersByUser.get(secondUser.id)).toEqual([2]);
    expect(requestBodies).toEqual([
      {
        id: 901101,
        title: "Route Season Sync",
        titleSlug: "route-season-sync",
        tvdbId: 901101,
        monitored: true,
        seasons: [
          { seasonNumber: 1, monitored: true },
          { seasonNumber: 2, monitored: true },
        ],
      },
      { name: "SeasonSearch", seriesId: 901101, seasonNumber: 2 },
    ]);
  });
});

describe("session cookies", () => {
  test("marks cookies secure behind an HTTPS reverse proxy", () => {
    const request = new Request("http://cove.test/api/auth/jellyfin", {
      headers: {
        "X-Forwarded-Proto": "https",
      },
    });

    const secure = cookies.shouldUseSecureCookies(request);

    expect(secure).toBe(true);
    expect(cookies.makeSessionCookie("token", secure)).toContain("Secure");
  });

  test("keeps local HTTP cookies non-secure", () => {
    const request = new Request("http://cove.test/api/auth/jellyfin");
    const secure = cookies.shouldUseSecureCookies(request);
    const cookieAttributes = cookies
      .makeSessionCookie("token", secure)
      .split(";")
      .map((part) => part.trim().toLowerCase());

    expect(secure).toBe(false);
    expect(cookieAttributes).not.toContain("secure");
  });

  test("uses public origin before proxy headers for secure cookies", () => {
    const request = new Request("http://cove.test/api/auth/jellyfin", {
      headers: {
        "X-Forwarded-Proto": "http",
      },
    });

    expect(cookies.shouldUseSecureCookies(request, undefined, "https://cove.example")).toBe(true);
  });
});

describe("request origin protection", () => {
  test("allows unsafe requests from the configured public origin", () => {
    const request = new Request("http://internal.test/api/requests", {
      method: "POST",
      headers: {
        Origin: "https://cove.example",
      },
    });

    expect(requestSecurity.hasTrustedRequestOrigin(request, "https://cove.example")).toBe(true);
  });

  test("rejects unsafe requests from another origin", () => {
    const request = new Request("http://internal.test/api/requests", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
      },
    });

    expect(requestSecurity.hasTrustedRequestOrigin(request, "https://cove.example")).toBe(false);
  });

  test("allows loopback development origins", () => {
    const request = new Request("http://127.0.0.1:3000/api/requests", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:5173",
      },
    });

    expect(requestSecurity.hasTrustedRequestOrigin(request, "http://127.0.0.1:3000")).toBe(true);
  });

  test("rejects same-site fetch metadata without an origin", () => {
    const request = new Request("https://cove.example/api/requests", {
      method: "POST",
      headers: {
        "Sec-Fetch-Site": "same-site",
      },
    });

    expect(requestSecurity.hasTrustedRequestOrigin(request, "https://cove.example")).toBe(false);
  });

  test("rejects untrusted origins before routing unsafe API requests", async () => {
    const { userSession } = createRouteTestSessions("route-origin");

    const response = await apiRequest(
      "/api/requests",
      userSession.token,
      "POST",
      {
        mediaType: "movie",
        tmdbId: 9501,
        title: "Blocked Origin",
      },
      {
        Origin: "https://evil.example",
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Request origin is not allowed." });
  });
});

describe("static serving", () => {
  test("rejects malformed encoded paths", async () => {
    const response = await staticServer.serveClient("/%");

    expect(response.status).toBe(404);
    expectSecurityHeaders(response);
  });
});
