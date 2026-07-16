import { describe, expect, test } from "bun:test";

import { db, expectPrivateTestDatabase, requestOwner } from "./support";

describe("request storage", () => {
  test("keeps the data directory and database private to the owner", () => {
    expectPrivateTestDatabase();
  });

  test("creates and updates Jellyfin users", () => {
    const created = db.upsertJellyfinUser({
      jellyfinUserId: "jf-user-upsert",
      name: "old-name",
      isAdministrator: false,
    });
    const updated = db.upsertJellyfinUser({
      jellyfinUserId: "jf-user-upsert",
      name: "new-name",
      isAdministrator: true,
    });

    expect(updated).toEqual({
      id: created.id,
      jellyfinUserId: "jf-user-upsert",
      name: "new-name",
      isAdministrator: true,
    });
  });

  test("reconciles local users with Jellyfin users", () => {
    const admin = db.upsertJellyfinUser({
      jellyfinUserId: "jf-user-management-admin",
      name: "management-admin",
      isAdministrator: true,
    });
    const target = db.upsertJellyfinUser({
      jellyfinUserId: "jf-user-management-target",
      name: "management-target",
      isAdministrator: false,
    });
    db.createRequest({
      mediaType: "movie",
      tmdbId: 10001,
      title: "Managed Request 1",
      requestedByUserId: target.id,
    });
    db.createRequest({
      mediaType: "movie",
      tmdbId: 10002,
      title: "Managed Request 2",
      requestedByUserId: target.id,
    });

    const listed = db.listUsers().find((user) => user.id === target.id);
    expect(listed).toMatchObject({
      id: target.id,
      jellyfinUserId: "jf-user-management-target",
      name: "management-target",
      isAdministrator: false,
      requestCount: 2,
    });

    const result = db.reconcileJellyfinUsers(
      [
        {
          jellyfinUserId: admin.jellyfinUserId,
          name: admin.name,
          isAdministrator: admin.isAdministrator,
        },
      ],
      admin.id,
    );
    expect(result.removedCount).toBeGreaterThanOrEqual(1);
    expect(db.getUser(target.id)).toBeUndefined();
    expect(db.listRequests({ requestedByUserId: target.id })).toEqual([]);
  });

  test("does not reconcile users when Jellyfin omits the current admin", () => {
    const admin = db.upsertJellyfinUser({
      jellyfinUserId: "jf-reconcile-guard-admin",
      name: "reconcile-guard-admin",
      isAdministrator: true,
    });
    const existing = db.upsertJellyfinUser({
      jellyfinUserId: "jf-reconcile-guard-user",
      name: "reconcile-guard-user",
      isAdministrator: false,
    });

    expect(() =>
      db.reconcileJellyfinUsers(
        [
          {
            jellyfinUserId: "jf-unrelated-user",
            name: "unrelated-user",
            isAdministrator: false,
          },
        ],
        admin.id,
      ),
    ).toThrow("Jellyfin user sync did not include your account.");
    expect(db.getUser(admin.id)).toBeDefined();
    expect(db.getUser(existing.id)).toBeDefined();
  });

  test("does not automatically reconcile an invalid Jellyfin user list", () => {
    const admin = db.upsertJellyfinUser({
      jellyfinUserId: "jf-automatic-reconcile-guard-admin",
      name: "automatic-reconcile-guard-admin",
      isAdministrator: true,
    });
    const existing = db.upsertJellyfinUser({
      jellyfinUserId: "jf-automatic-reconcile-guard-user",
      name: "automatic-reconcile-guard-user",
      isAdministrator: false,
    });

    expect(() =>
      db.reconcileJellyfinUsers([
        {
          jellyfinUserId: "jf-automatic-reconcile-non-admin",
          name: "automatic-reconcile-non-admin",
          isAdministrator: false,
        },
      ]),
    ).toThrow("Jellyfin user sync did not include an administrator.");
    expect(db.getUser(admin.id)).toBeDefined();
    expect(db.getUser(existing.id)).toBeDefined();
  });

  test("creates requests and returns an existing duplicate for the same user", () => {
    const created = db.createRequest({
      mediaType: "movie",
      tmdbId: 1001,
      title: "Duplicate Test",
      ...requestOwner("alice"),
    });
    const duplicate = db.createRequest({
      mediaType: "movie",
      tmdbId: 1001,
      title: "Duplicate Test",
      ...requestOwner("alice"),
    });

    expect(created.availability).toBe("requested");
    expect(duplicate.id).toBe(created.id);
    expect(
      db
        .listRequests()
        .filter((request) => request.mediaType === "movie" && request.tmdbId === 1001),
    ).toHaveLength(1);
  });

  test("uses stable user IDs for request ownership", () => {
    const user = db.upsertJellyfinUser({
      jellyfinUserId: "jf-request-owner",
      name: "owner-before-rename",
      isAdministrator: false,
    });

    const created = db.createRequest({
      mediaType: "movie",
      tmdbId: 1002,
      title: "Stable Owner Test",
      requestedByUserId: user.id,
    });
    const renamed = db.upsertJellyfinUser({
      jellyfinUserId: "jf-request-owner",
      name: "owner-after-rename",
      isAdministrator: false,
    });
    const duplicate = db.createRequest({
      mediaType: "movie",
      tmdbId: 1002,
      title: "Stable Owner Test",
      requestedByUserId: renamed.id,
    });

    expect(duplicate.id).toBe(created.id);
    expect(duplicate.requestedByUserId).toBe(user.id);
    expect(duplicate.requestedBy).toBe("owner-after-rename");
    expect(db.listRequests({ requestedByUserId: user.id }).map((request) => request.id)).toEqual([
      created.id,
    ]);
  });

  test("stores selected TV seasons and merges repeat requests", () => {
    const created = db.createRequest({
      mediaType: "tv",
      tmdbId: 1003,
      title: "Season Selection Test",
      ...requestOwner("season-alice"),
      seasonNumbers: [2, 1],
    });
    const updated = db.createRequest({
      mediaType: "tv",
      tmdbId: 1003,
      title: "Season Selection Test",
      ...requestOwner("season-alice"),
      seasonNumbers: [2, 3],
    });

    expect(created.seasonNumbers).toEqual([1, 2]);
    expect(updated.id).toBe(created.id);
    expect(updated.seasonNumbers).toEqual([1, 2, 3]);
  });

  test("deletes requests", () => {
    const created = db.createRequest({
      mediaType: "tv",
      tmdbId: 2001,
      title: "Lifecycle Test",
      ...requestOwner("bob"),
    });

    db.deleteRequest(created.id);
    expect(db.getRequest(created.id)).toBeUndefined();
  });

  test("filters requests by owner", () => {
    const alice = requestOwner("filter-alice");
    const charlie = requestOwner("filter-charlie");

    db.createRequest({
      mediaType: "movie",
      tmdbId: 3001,
      title: "Alice Request",
      ...alice,
    });
    db.createRequest({
      mediaType: "movie",
      tmdbId: 3002,
      title: "Charlie Request",
      ...charlie,
    });

    expect(
      db
        .listRequests({ requestedByUserId: alice.requestedByUserId })
        .map((request) => request.title),
    ).toEqual(["Alice Request"]);
    expect(
      db
        .listRequests({ requestedByUserId: charlie.requestedByUserId })
        .map((request) => request.title),
    ).toEqual(["Charlie Request"]);
  });

  test("counts and paginates requests by owner", () => {
    const owner = requestOwner("paged-owner");
    for (const [index, title] of ["First", "Second", "Third"].entries()) {
      db.createRequest({
        mediaType: "movie",
        tmdbId: 3100 + index,
        title,
        ...owner,
      });
    }

    expect(db.countRequests({ requestedByUserId: owner.requestedByUserId })).toBe(3);
    expect(
      db.listRequests({
        requestedByUserId: owner.requestedByUserId,
        limit: 1,
        offset: 1,
      }),
    ).toEqual([expect.objectContaining({ title: "Second" })]);
  });

  test("keeps duplicate user intent for the same media", () => {
    const first = db.createRequest({
      mediaType: "movie",
      tmdbId: 4001,
      title: "Shared Request",
      ...requestOwner("shared-alice"),
    });
    const second = db.createRequest({
      mediaType: "movie",
      tmdbId: 4001,
      title: "Shared Request",
      ...requestOwner("shared-bob"),
    });

    expect(first.id).not.toBe(second.id);
    expect(
      db
        .listRequestsForMedia("movie", 4001)
        .map((request) => request.requestedBy)
        .sort(),
    ).toEqual(["shared-alice", "shared-bob"]);

    const third = db.createRequest({
      mediaType: "movie",
      tmdbId: 4001,
      title: "Shared Request",
      ...requestOwner("shared-charlie"),
    });
    expect(third.availability).toBe("requested");
  });

  test("stores Arr references once per media item", () => {
    db.upsertArrMediaReference({
      mediaType: "movie",
      tmdbId: 4010,
      itemId: 41,
      titleSlug: "stored-movie",
    });
    db.upsertArrMediaReference({
      mediaType: "movie",
      tmdbId: 4010,
      itemId: 42,
      titleSlug: "updated-movie",
    });

    expect(db.getArrMediaReference("movie", 4010)).toEqual({
      mediaType: "movie",
      tmdbId: 4010,
      itemId: 42,
      titleSlug: "updated-movie",
    });
    expect(db.getArrMediaReference("tv", 4010)).toBeUndefined();
  });

  test("blocks new requests for available media", () => {
    db.replaceAvailableMedia([
      {
        mediaType: "movie",
        tmdbId: 4002,
        jellyfinItemId: "jf-movie-4002",
      },
    ]);

    expect(() =>
      db.createRequest({
        mediaType: "movie",
        tmdbId: 4002,
        title: "Available Request",
        ...requestOwner("available-alice"),
      }),
    ).toThrow("This title is already available.");
  });

  test("blocks requests for synced Jellyfin media and marks matching requests available", () => {
    const existing = db.createRequest({
      mediaType: "movie",
      tmdbId: 4003,
      title: "Synced Available Request",
      ...requestOwner("available-sync-alice"),
    });

    const result = db.replaceAvailableMedia([
      {
        mediaType: "movie",
        tmdbId: 4003,
        jellyfinItemId: "jf-movie-4003",
      },
    ]);

    expect(result).toEqual({ availableCount: 1 });
    expect(db.getRequest(existing.id)?.availability).toBe("available");
    expect(() =>
      db.createRequest({
        mediaType: "movie",
        tmdbId: 4003,
        title: "Synced Available Request",
        ...requestOwner("available-sync-bob"),
      }),
    ).toThrow("This title is already available.");
  });

  test("tracks available seasons while selected TV requests remain requested", () => {
    const existing = db.createRequest({
      mediaType: "tv",
      tmdbId: 4004,
      title: "Season Availability Series",
      ...requestOwner("season-alice"),
      seasonNumbers: [1, 2],
    });

    db.replaceAvailableMedia(
      [
        {
          mediaType: "tv",
          tmdbId: 4004,
          jellyfinItemId: "jf-series-4004",
        },
      ],
      [
        {
          tmdbId: 4004,
          seasonNumber: 1,
        },
      ],
    );

    const requested = db.getRequest(existing.id);
    expect(requested?.availability).toBe("requested");
    expect(requested?.availableSeasonNumbers).toEqual([1]);

    db.upsertAvailableMedia(
      [],
      [
        {
          tmdbId: 4004,
          seasonNumber: 2,
        },
      ],
    );

    const available = db.getRequest(existing.id);
    expect(available?.availability).toBe("available");
    expect(available?.availableSeasonNumbers).toEqual([1, 2]);
    expect(() =>
      db.createRequest({
        mediaType: "tv",
        tmdbId: 4004,
        title: "Season Availability Series",
        ...requestOwner("season-bob"),
        seasonNumbers: [1, 2],
      }),
    ).toThrow("This title is already available.");
  });
});

describe("auth sessions", () => {
  test("creates, reads, and deletes sessions", () => {
    const user = db.upsertJellyfinUser({
      jellyfinUserId: "jf-user-1",
      name: "test",
      isAdministrator: false,
    });
    const session = db.createAuthSession(user);

    const loaded = db.getAuthSession(session.token);
    expect(loaded?.user).toEqual(user);

    db.deleteAuthSession(session.token);
    expect(db.getAuthSession(session.token)).toBeUndefined();
  });
});

describe("integration settings", () => {
  test("stores integration settings in SQLite", () => {
    const settings = db.saveIntegrationSettings({
      publicOrigin: "https://cove-settings.test/base",
      jellyfinUrl: "http://jellyfin-settings.test/",
      jellyfinApiKey: "jellyfin-settings-key",
      tmdbToken: "Bearer tmdb-settings-token",
      radarrUrl: "http://radarr-settings.test/radarr/",
      radarrApiKey: "radarr-settings-key",
      radarrRootFolderPath: "/movies",
      radarrQualityProfileId: 3,
      sonarrUrl: "http://sonarr-settings.test/sonarr/",
      sonarrApiKey: "sonarr-settings-key",
      sonarrRootFolderPath: "/tv",
      sonarrAnimeRootFolderPath: "/anime",
      sonarrQualityProfileId: 4,
    });

    expect(settings).toEqual({
      app: {
        publicOrigin: "https://cove-settings.test",
      },
      tmdb: {
        token: "tmdb-settings-token",
      },
      jellyfin: {
        url: "http://jellyfin-settings.test",
        apiKey: "jellyfin-settings-key",
      },
      radarr: {
        url: "http://radarr-settings.test/radarr",
        apiKey: "radarr-settings-key",
        rootFolderPath: "/movies",
        qualityProfileId: 3,
      },
      sonarr: {
        url: "http://sonarr-settings.test/sonarr",
        apiKey: "sonarr-settings-key",
        rootFolderPath: "/tv",
        animeRootFolderPath: "/anime",
        qualityProfileId: 4,
      },
    });
    expect(db.settingsSummary().integrations).toMatchObject({
      tmdb: true,
      jellyfin: true,
      radarrReady: true,
      sonarrReady: true,
    });
    expect(db.settingsSummary().setupRequired).toBe(true);

    db.completeSetup();
    expect(db.settingsSummary().setupRequired).toBe(false);
  });

  test("rejects non-HTTP integration URLs", () => {
    expect(() =>
      db.saveIntegrationSettings({
        jellyfinUrl: "file:///tmp/jellyfin",
      }),
    ).toThrow("Integration URLs must start with http:// or https://.");
  });

  test("rejects non-HTTP public URLs", () => {
    expect(() =>
      db.saveIntegrationSettings({
        publicOrigin: "file:///tmp/cove",
      }),
    ).toThrow("Public URL must start with http:// or https://.");
  });

  test("returns admin settings without secrets and clears selected settings", () => {
    db.saveIntegrationSettings({
      publicOrigin: "https://cove-admin-settings.test",
      jellyfinUrl: "http://jellyfin-admin-settings.test",
      jellyfinApiKey: "admin-jellyfin-key",
      tmdbToken: "admin-tmdb-token",
      radarrUrl: "http://radarr-admin-settings.test",
      radarrApiKey: "admin-radarr-key",
      radarrRootFolderPath: "/admin-movies",
      radarrQualityProfileId: 5,
      sonarrUrl: "http://sonarr-admin-settings.test",
      sonarrApiKey: "admin-sonarr-key",
      sonarrRootFolderPath: "/admin-tv",
      sonarrAnimeRootFolderPath: "/admin-anime",
      sonarrQualityProfileId: 6,
    });

    expect(db.adminIntegrationSettings()).toEqual({
      app: {
        publicOrigin: "https://cove-admin-settings.test",
      },
      tmdb: {
        tokenConfigured: true,
      },
      jellyfin: {
        url: "http://jellyfin-admin-settings.test",
        apiKeyConfigured: true,
      },
      radarr: {
        url: "http://radarr-admin-settings.test",
        apiKeyConfigured: true,
        rootFolderPath: "/admin-movies",
        qualityProfileId: 5,
      },
      sonarr: {
        url: "http://sonarr-admin-settings.test",
        apiKeyConfigured: true,
        rootFolderPath: "/admin-tv",
        animeRootFolderPath: "/admin-anime",
        qualityProfileId: 6,
      },
    });

    db.clearIntegrationSettings([
      "radarr.url",
      "radarr.apiKey",
      "radarr.rootFolderPath",
      "radarr.qualityProfileId",
    ]);

    expect(db.adminIntegrationSettings().radarr).toEqual({
      url: undefined,
      apiKeyConfigured: false,
      rootFolderPath: undefined,
      qualityProfileId: undefined,
    });
  });
});
