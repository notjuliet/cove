import { describe, expect, test } from "bun:test";

import { db, jobs, jsonResponse } from "./support";

describe("background jobs", () => {
  test("skips Jellyfin availability sync until Jellyfin is configured", async () => {
    db.completeSetup();
    db.clearIntegrationSettings(["jellyfin.url", "jellyfin.apiKey"]);

    const result = await jobs.runJellyfinRecentAvailabilitySyncJob();

    expect(result).toEqual({
      skipped: true,
      reason: "jellyfin-not-configured",
    });
  });

  test("runs a full Jellyfin availability sync when configured", async () => {
    db.completeSetup();
    db.saveIntegrationSettings({
      jellyfinUrl: "http://jellyfin-job.test",
      jellyfinApiKey: "job-api-key",
    });

    globalThis.fetch = (async (url, init) => {
      expect(new Headers(init?.headers).get("X-Emby-Token")).toBe("job-api-key");

      if (String(url) === "http://jellyfin-job.test/Library/VirtualFolders") {
        return jsonResponse([{ ItemId: "job-library", Name: "Movies", CollectionType: "movies" }]);
      }

      expect(String(url)).toBe(
        "http://jellyfin-job.test/Items?ParentId=job-library&Recursive=true&IncludeItemTypes=Movie%2CSeries%2CSeason&Fields=ProviderIds&StartIndex=0&Limit=200",
      );

      return jsonResponse({
        Items: [
          {
            Id: "job-movie",
            Name: "Job Movie",
            Type: "Movie",
            ProviderIds: { Tmdb: "9301" },
          },
        ],
      });
    }) as typeof fetch;

    const result = await jobs.runJellyfinFullAvailabilitySyncJob({ force: true });

    expect(result).toEqual({
      skipped: false,
      mode: "full",
      availableCount: 1,
    });
    expect(db.isMediaAvailable("movie", 9301)).toBe(true);
  });

  test("periodically reconciles Jellyfin users and revokes departed sessions", async () => {
    db.completeSetup();
    db.saveIntegrationSettings({
      jellyfinUrl: "http://jellyfin-user-job.test",
      jellyfinApiKey: "user-job-api-key",
    });
    const retainedAdmin = db.upsertJellyfinUser({
      jellyfinUserId: "jf-user-job-admin",
      name: "Old Admin Name",
      isAdministrator: true,
    });
    const departedUser = db.upsertJellyfinUser({
      jellyfinUserId: "jf-user-job-departed",
      name: "Departed User",
      isAdministrator: false,
    });
    const departedSession = db.createAuthSession(departedUser);

    globalThis.fetch = (async (url, init) => {
      expect(String(url)).toBe("http://jellyfin-user-job.test/Users");
      expect(new Headers(init?.headers).get("X-Emby-Token")).toBe("user-job-api-key");

      return jsonResponse([
        {
          Id: retainedAdmin.jellyfinUserId,
          Name: "Updated Admin Name",
          Policy: { IsAdministrator: true },
        },
        {
          Id: "jf-user-job-new",
          Name: "New User",
          Policy: { IsAdministrator: false },
        },
      ]);
    }) as typeof fetch;

    const result = await jobs.runJellyfinUserSyncJob({ force: true });

    expect(result.skipped).toBe(false);
    if (result.skipped) {
      throw new Error("Expected the Jellyfin user sync to run.");
    }
    expect(result.syncedCount).toBe(2);
    expect(result.removedCount).toBeGreaterThanOrEqual(1);
    expect(db.getUser(retainedAdmin.id)).toMatchObject({
      name: "Updated Admin Name",
      isAdministrator: true,
    });
    expect(db.getUser(departedUser.id)).toBeUndefined();
    expect(db.getAuthSession(departedSession.token)).toBeUndefined();
  });

  test("paginates recently added Jellyfin sync until the last successful sync", async () => {
    db.completeSetup();
    db.saveIntegrationSettings({
      jellyfinUrl: "http://jellyfin-recent.test",
      jellyfinApiKey: "recent-api-key",
    });
    db.setBackgroundJobTimestamp("jobs.jellyfinRecentSync.completedAt", "2026-06-24T12:00:00.000Z");

    const startIndexes: string[] = [];

    globalThis.fetch = (async (url, init) => {
      expect(new Headers(init?.headers).get("X-Emby-Token")).toBe("recent-api-key");

      if (String(url) === "http://jellyfin-recent.test/Library/VirtualFolders") {
        return jsonResponse([
          { ItemId: "recent-library", Name: "Series", CollectionType: "tvshows" },
        ]);
      }

      const requestUrl = new URL(String(url));
      expect(requestUrl.origin).toBe("http://jellyfin-recent.test");
      expect(requestUrl.pathname).toBe("/Items");
      expect(requestUrl.searchParams.get("SortBy")).toBe("DateCreated");
      expect(requestUrl.searchParams.get("SortOrder")).toBe("Descending");
      startIndexes.push(requestUrl.searchParams.get("StartIndex") ?? "");

      if (requestUrl.searchParams.get("StartIndex") === "0") {
        return jsonResponse({
          Items: Array.from({ length: 200 }, (_, index) => ({
            Id: `recent-movie-${index}`,
            Name: `Recent Movie ${index}`,
            Type: "Movie",
            DateCreated: "2026-06-24T12:10:00.000Z",
            ProviderIds: { Tmdb: String(9400 + index) },
          })),
        });
      }

      return jsonResponse({
        Items: [
          {
            Id: "old-movie",
            Name: "Old Movie",
            Type: "Movie",
            DateCreated: "2026-06-24T11:59:59.000Z",
            ProviderIds: { Tmdb: "9999" },
          },
        ],
      });
    }) as typeof fetch;

    const result = await jobs.runJellyfinRecentAvailabilitySyncJob();

    expect(result).toEqual({
      skipped: false,
      mode: "recent",
      availableCount: 200,
    });
    expect(startIndexes).toEqual(["0", "200"]);
    expect(db.isMediaAvailable("movie", 9400)).toBe(true);
    expect(db.isMediaAvailable("movie", 9599)).toBe(true);
    expect(db.isMediaAvailable("movie", 9999)).toBe(false);
  });
});
