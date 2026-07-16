import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type {
  AdminIntegrationSettings,
  AdminUser,
  AppSettingsSummary,
  AuthUser,
  CreateMediaRequest,
  MediaRequest,
  MediaType,
  RequestAvailability,
} from "../shared/types";
import { config } from "./config";
import { HttpError } from "./errors";
import { normalizeOrigin, normalizeUrl, optionalBearerToken, optionalText } from "./validate";

const requestColumns = `
  media_requests.id,
  media_requests.media_type,
  media_requests.tmdb_id,
  media_requests.title,
  media_requests.poster_path,
  media_requests.backdrop_path,
  media_requests.release_date,
  media_requests.requested_by_user_id,
  users.name AS requested_by,
  media_requests.season_numbers,
  media_requests.created_at
`;

const requestJoin = "JOIN users ON users.id = media_requests.requested_by_user_id";

type RequestRow = {
  id: number;
  media_type: MediaType;
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null;
  requested_by_user_id: number;
  requested_by: string;
  season_numbers: string | null;
  created_at: string;
};

type SessionRow = {
  user_id: number;
  expires_at: string;
};

type UserRow = {
  id: number;
  jellyfin_user_id: string;
  name: string;
  is_administrator: number;
  created_at: string;
};

type AdminUserRow = UserRow & {
  request_count: number;
};

type RequestListOptions = {
  requestedByUserId?: number;
  limit?: number;
  offset?: number;
};

export type AvailableMediaInput = {
  mediaType: MediaType;
  tmdbId: number;
  jellyfinItemId: string;
};

export type AvailableSeasonInput = {
  tmdbId: number;
  seasonNumber: number;
};

export type ArrMediaReference = {
  mediaType: MediaType;
  tmdbId: number;
  itemId: number;
  titleSlug: string;
};

const integrationSettingKeys = [
  "app.publicOrigin",
  "tmdb.token",
  "jellyfin.url",
  "jellyfin.apiKey",
  "radarr.url",
  "radarr.apiKey",
  "radarr.rootFolderPath",
  "radarr.qualityProfileId",
  "sonarr.url",
  "sonarr.apiKey",
  "sonarr.rootFolderPath",
  "sonarr.animeRootFolderPath",
  "sonarr.qualityProfileId",
] as const;

export type IntegrationSettingKey = (typeof integrationSettingKeys)[number];

export type IntegrationSettings = {
  app: {
    publicOrigin?: string;
  };
  tmdb: {
    token?: string;
  };
  jellyfin: {
    url?: string;
    apiKey?: string;
  };
  radarr: {
    url?: string;
    apiKey?: string;
    rootFolderPath?: string;
    qualityProfileId?: number;
  };
  sonarr: {
    url?: string;
    apiKey?: string;
    rootFolderPath?: string;
    animeRootFolderPath?: string;
    qualityProfileId?: number;
  };
};

export type IntegrationSettingsInput = {
  publicOrigin?: string;
  tmdbToken?: string;
  jellyfinUrl?: string;
  jellyfinApiKey?: string;
  radarrUrl?: string;
  radarrApiKey?: string;
  radarrRootFolderPath?: string;
  radarrQualityProfileId?: number;
  sonarrUrl?: string;
  sonarrApiKey?: string;
  sonarrRootFolderPath?: string;
  sonarrAnimeRootFolderPath?: string;
  sonarrQualityProfileId?: number;
};

export type AuthSession = {
  user: AuthUser;
  expiresAt: string;
};

export type NewAuthSession = AuthSession & {
  token: string;
};

export type BackgroundJobTimestampKey =
  | "jobs.jellyfinFullSync.completedAt"
  | "jobs.jellyfinRecentSync.completedAt"
  | "jobs.jellyfinUserSync.completedAt";

const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;

ensurePrivateDataDirectory(dirname(config.databasePath));
ensurePrivateDatabaseFiles(config.databasePath);
const db = new Database(config.databasePath);
db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA foreign_keys = ON;");

createSchema();
ensurePrivateDatabaseFiles(config.databasePath);

export function upsertJellyfinUser(input: Omit<AuthUser, "id">): AuthUser {
  const now = new Date().toISOString();
  const row = db
    .query(
      `
      INSERT INTO users (
        jellyfin_user_id,
        name,
        is_administrator,
        created_at
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(jellyfin_user_id) DO UPDATE SET
        name = excluded.name,
        is_administrator = excluded.is_administrator
      RETURNING *
    `,
    )
    .get(input.jellyfinUserId, input.name, input.isAdministrator ? 1 : 0, now) as UserRow;

  return rowToUser(row);
}

export function reconcileJellyfinUsers(
  users: Array<Omit<AuthUser, "id">>,
  currentUserId?: number,
): { syncedCount: number; removedCount: number } {
  const jellyfinUserIds = new Set(users.map((user) => user.jellyfinUserId));
  if (currentUserId !== undefined) {
    const currentUser = getUser(currentUserId);
    if (!currentUser) {
      throw new HttpError(401, "Current user not found.");
    }

    if (!jellyfinUserIds.has(currentUser.jellyfinUserId)) {
      throw new HttpError(502, "Jellyfin user sync did not include your account.");
    }
  } else if (users.length === 0 || !users.some((user) => user.isAdministrator)) {
    throw new HttpError(502, "Jellyfin user sync did not include an administrator.");
  }

  const staleUserIds = listUsers()
    .filter((user) => !jellyfinUserIds.has(user.jellyfinUserId))
    .map((user) => user.id);
  const reconcile = db.transaction(
    (nextUsers: Array<Omit<AuthUser, "id">>, userIdsToDelete: number[]) => {
      for (const user of nextUsers) {
        upsertJellyfinUser(user);
      }

      const deleteUser = db.query("DELETE FROM users WHERE id = ?");
      for (const userId of userIdsToDelete) {
        deleteUser.run(userId);
      }
    },
  );

  reconcile(users, staleUserIds);

  return {
    syncedCount: jellyfinUserIds.size,
    removedCount: staleUserIds.length,
  };
}

export function hasCompletedSetup(): boolean {
  return getSetting("setup.complete") === "true";
}

export function completeSetup(): void {
  setSetting("setup.complete", "true");
}

export function saveIntegrationSettings(input: IntegrationSettingsInput): IntegrationSettings {
  const values: Record<string, string | undefined> = {
    "app.publicOrigin": normalizeOrigin(input.publicOrigin),
    "tmdb.token": optionalBearerToken(input.tmdbToken),
    "jellyfin.url": normalizeUrl(input.jellyfinUrl),
    "jellyfin.apiKey": optionalText(input.jellyfinApiKey),
    "radarr.url": normalizeUrl(input.radarrUrl),
    "radarr.apiKey": optionalText(input.radarrApiKey),
    "radarr.rootFolderPath": optionalText(input.radarrRootFolderPath),
    "radarr.qualityProfileId": optionalNumberText(input.radarrQualityProfileId),
    "sonarr.url": normalizeUrl(input.sonarrUrl),
    "sonarr.apiKey": optionalText(input.sonarrApiKey),
    "sonarr.rootFolderPath": optionalText(input.sonarrRootFolderPath),
    "sonarr.animeRootFolderPath": optionalText(input.sonarrAnimeRootFolderPath),
    "sonarr.qualityProfileId": optionalNumberText(input.sonarrQualityProfileId),
  };

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      setSetting(key, value);
    }
  }

  return getIntegrationSettings();
}

export function clearIntegrationSettings(keys: IntegrationSettingKey[]): IntegrationSettings {
  for (const key of keys) {
    deleteSetting(key);
  }

  return getIntegrationSettings();
}

export function getIntegrationSettings(): IntegrationSettings {
  return {
    app: {
      publicOrigin: getSetting("app.publicOrigin"),
    },
    tmdb: {
      token: getSetting("tmdb.token"),
    },
    jellyfin: {
      url: getSetting("jellyfin.url"),
      apiKey: getSetting("jellyfin.apiKey"),
    },
    radarr: {
      url: getSetting("radarr.url"),
      apiKey: getSetting("radarr.apiKey"),
      rootFolderPath: getSetting("radarr.rootFolderPath"),
      qualityProfileId: optionalNumber(getSetting("radarr.qualityProfileId")),
    },
    sonarr: {
      url: getSetting("sonarr.url"),
      apiKey: getSetting("sonarr.apiKey"),
      rootFolderPath: getSetting("sonarr.rootFolderPath"),
      animeRootFolderPath: getSetting("sonarr.animeRootFolderPath"),
      qualityProfileId: optionalNumber(getSetting("sonarr.qualityProfileId")),
    },
  };
}

export function adminIntegrationSettings(): AdminIntegrationSettings {
  const settings = getIntegrationSettings();

  return {
    app: {
      publicOrigin: settings.app.publicOrigin,
    },
    tmdb: {
      tokenConfigured: Boolean(settings.tmdb.token),
    },
    jellyfin: {
      url: settings.jellyfin.url,
      apiKeyConfigured: Boolean(settings.jellyfin.apiKey),
    },
    radarr: {
      url: settings.radarr.url,
      apiKeyConfigured: Boolean(settings.radarr.apiKey),
      rootFolderPath: settings.radarr.rootFolderPath,
      qualityProfileId: settings.radarr.qualityProfileId,
    },
    sonarr: {
      url: settings.sonarr.url,
      apiKeyConfigured: Boolean(settings.sonarr.apiKey),
      rootFolderPath: settings.sonarr.rootFolderPath,
      animeRootFolderPath: settings.sonarr.animeRootFolderPath,
      qualityProfileId: settings.sonarr.qualityProfileId,
    },
  };
}

export function getPublicOrigin(): string | undefined {
  return getSetting("app.publicOrigin");
}

export function settingsSummary(): AppSettingsSummary {
  const settings = getIntegrationSettings();

  return {
    setupRequired: !hasCompletedSetup(),
    integrations: {
      tmdb: Boolean(settings.tmdb.token),
      radarr: Boolean(settings.radarr.url && settings.radarr.apiKey),
      radarrReady: Boolean(
        settings.radarr.url &&
        settings.radarr.apiKey &&
        settings.radarr.rootFolderPath &&
        settings.radarr.qualityProfileId,
      ),
      sonarr: Boolean(settings.sonarr.url && settings.sonarr.apiKey),
      sonarrReady: Boolean(
        settings.sonarr.url &&
        settings.sonarr.apiKey &&
        settings.sonarr.rootFolderPath &&
        settings.sonarr.qualityProfileId,
      ),
      jellyfin: Boolean(settings.jellyfin.url),
    },
  };
}

export function getUser(id: number): AuthUser | undefined {
  const row = db.query("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
  return row ? rowToUser(row) : undefined;
}

export function listUsers(): AdminUser[] {
  const rows = db
    .query(
      `
      SELECT
        users.*,
        COUNT(media_requests.id) AS request_count
      FROM users
      LEFT JOIN media_requests ON media_requests.requested_by_user_id = users.id
      GROUP BY users.id
      ORDER BY users.created_at ASC, users.id ASC
    `,
    )
    .all() as AdminUserRow[];

  return rows.map(rowToAdminUser);
}

export function listRequests(options: RequestListOptions = {}): MediaRequest[] {
  const limit = options.limit ?? -1;
  const offset = options.offset ?? 0;
  const rows =
    options.requestedByUserId !== undefined
      ? (db
          .query(
            `
            SELECT ${requestColumns}
            FROM media_requests
            ${requestJoin}
            WHERE media_requests.requested_by_user_id = ?
            ORDER BY media_requests.created_at DESC, media_requests.id DESC
            LIMIT ? OFFSET ?
          `,
          )
          .all(options.requestedByUserId, limit, offset) as RequestRow[])
      : (db
          .query(
            `
            SELECT ${requestColumns}
            FROM media_requests
            ${requestJoin}
            ORDER BY media_requests.created_at DESC, media_requests.id DESC
            LIMIT ? OFFSET ?
          `,
          )
          .all(limit, offset) as RequestRow[]);
  return rows.map(rowToRequest);
}

export function countRequests(options: Pick<RequestListOptions, "requestedByUserId"> = {}): number {
  const row =
    options.requestedByUserId !== undefined
      ? (db
          .query("SELECT COUNT(*) AS count FROM media_requests WHERE requested_by_user_id = ?")
          .get(options.requestedByUserId) as { count: number })
      : (db.query("SELECT COUNT(*) AS count FROM media_requests").get() as { count: number });
  return row.count;
}

export function getRequest(id: number): MediaRequest | undefined {
  const row = db
    .query(
      `
      SELECT ${requestColumns}
      FROM media_requests
      ${requestJoin}
      WHERE media_requests.id = ?
    `,
    )
    .get(id) as RequestRow | null;
  return row ? rowToRequest(row) : undefined;
}

export function listRequestsForMedia(mediaType: MediaType, tmdbId: number): MediaRequest[] {
  const rows = db
    .query(
      `
      SELECT ${requestColumns}
      FROM media_requests
      ${requestJoin}
      WHERE media_requests.media_type = ? AND media_requests.tmdb_id = ?
      ORDER BY media_requests.created_at DESC
    `,
    )
    .all(mediaType, tmdbId) as RequestRow[];
  return rows.map(rowToRequest);
}

export function isMediaAvailable(mediaType: MediaType, tmdbId: number): boolean {
  const row = db
    .query("SELECT 1 FROM available_media WHERE media_type = ? AND tmdb_id = ?")
    .get(mediaType, tmdbId) as { 1: number } | null;
  return Boolean(row);
}

function hasRequestForMedia(mediaType: MediaType, tmdbId: number): boolean {
  const row = db
    .query("SELECT id FROM media_requests WHERE media_type = ? AND tmdb_id = ? LIMIT 1")
    .get(mediaType, tmdbId) as { id: number } | null;
  return Boolean(row);
}

export function isRequestAvailable(
  mediaType: MediaType,
  tmdbId: number,
  seasonNumbers?: number[],
): boolean {
  return availabilityDetails(mediaType, tmdbId, seasonNumbers).availability === "available";
}

export function searchAvailabilityDetails(
  mediaType: MediaType,
  tmdbId: number,
): { availability?: RequestAvailability; availableSeasonNumbers?: number[] } {
  if (mediaType !== "tv") {
    if (isMediaAvailable(mediaType, tmdbId)) {
      return { availability: "available" };
    }

    return hasRequestForMedia(mediaType, tmdbId) ? { availability: "requested" } : {};
  }

  const seasons = availableSeasonNumbers(tmdbId);
  if (isMediaAvailable(mediaType, tmdbId) || seasons.length > 0) {
    return { availability: "available", availableSeasonNumbers: seasons };
  }

  return hasRequestForMedia(mediaType, tmdbId) ? { availability: "requested" } : {};
}

export function replaceAvailableMedia(
  items: AvailableMediaInput[],
  seasons: AvailableSeasonInput[] = [],
): {
  availableCount: number;
} {
  const replace = db.transaction(
    (nextItems: AvailableMediaInput[], nextSeasons: AvailableSeasonInput[]) => {
      db.query("DELETE FROM available_seasons").run();
      db.query("DELETE FROM available_media").run();
      insertAvailableMedia(nextItems);
      insertAvailableSeasons(nextSeasons);
    },
  );

  replace(items, seasons);

  return { availableCount: items.length };
}

export function upsertAvailableMedia(
  items: AvailableMediaInput[],
  seasons: AvailableSeasonInput[] = [],
): {
  availableCount: number;
} {
  insertAvailableMedia(items);
  insertAvailableSeasons(seasons);

  return { availableCount: items.length };
}

export function availableSeasonNumbers(tmdbId: number): number[] {
  const rows = db
    .query(
      `
      SELECT season_number
      FROM available_seasons
      WHERE tmdb_id = ?
      ORDER BY season_number
    `,
    )
    .all(tmdbId) as Array<{ season_number: number }>;
  return rows.map((row) => row.season_number);
}

export function getAvailableMediaByJellyfinItemId(
  jellyfinItemId: string,
): { tmdbId: number } | undefined {
  const row = db
    .query(
      `
      SELECT tmdb_id
      FROM available_media
      WHERE jellyfin_item_id = ?
    `,
    )
    .get(jellyfinItemId) as {
    tmdb_id: number;
  } | null;

  return row
    ? {
        tmdbId: row.tmdb_id,
      }
    : undefined;
}

export function getJellyfinItemUrlForMedia(
  mediaType: MediaType,
  tmdbId: number,
): string | undefined {
  const row = db
    .query(
      `
      SELECT jellyfin_item_id
      FROM available_media
      WHERE media_type = ? AND tmdb_id = ?
    `,
    )
    .get(mediaType, tmdbId) as { jellyfin_item_id: string } | null;

  if (!row) {
    return undefined;
  }

  const jellyfinUrl = getIntegrationSettings().jellyfin.url;
  if (!jellyfinUrl) {
    return undefined;
  }

  return `${jellyfinUrl}/web/index.html#!/details?id=${encodeURIComponent(row.jellyfin_item_id)}`;
}

export function getArrMediaReference(
  mediaType: MediaType,
  tmdbId: number,
): ArrMediaReference | undefined {
  const row = db
    .query(
      `
      SELECT service_item_id, title_slug
      FROM arr_media
      WHERE media_type = ? AND tmdb_id = ?
    `,
    )
    .get(mediaType, tmdbId) as { service_item_id: number; title_slug: string } | null;

  return row
    ? {
        mediaType,
        tmdbId,
        itemId: row.service_item_id,
        titleSlug: row.title_slug,
      }
    : undefined;
}

export function upsertArrMediaReference(reference: ArrMediaReference): void {
  db.query(
    `
    INSERT INTO arr_media (
      media_type,
      tmdb_id,
      service_item_id,
      title_slug
    )
    VALUES (?, ?, ?, ?)
    ON CONFLICT(media_type, tmdb_id) DO UPDATE SET
      service_item_id = excluded.service_item_id,
      title_slug = excluded.title_slug
  `,
  ).run(reference.mediaType, reference.tmdbId, reference.itemId, reference.titleSlug);
}

export function getBackgroundJobTimestamp(key: BackgroundJobTimestampKey): string | undefined {
  return getSetting(key);
}

export function setBackgroundJobTimestamp(key: BackgroundJobTimestampKey, value: string): void {
  setSetting(key, value);
}

function insertAvailableMedia(items: AvailableMediaInput[]): void {
  const insert = db.query(`
      INSERT INTO available_media (
        media_type,
        tmdb_id,
        jellyfin_item_id
      )
      VALUES (?, ?, ?)
      ON CONFLICT(media_type, tmdb_id) DO UPDATE SET
        jellyfin_item_id = excluded.jellyfin_item_id
    `);

  for (const item of items) {
    insert.run(item.mediaType, item.tmdbId, item.jellyfinItemId);
  }
}

function insertAvailableSeasons(items: AvailableSeasonInput[]): void {
  const insert = db.query(`
      INSERT INTO available_seasons (
        tmdb_id,
        season_number
      )
      VALUES (?, ?)
      ON CONFLICT(tmdb_id, season_number) DO NOTHING
    `);

  for (const item of items) {
    insert.run(item.tmdbId, item.seasonNumber);
  }
}

export function deleteRequest(id: number): void {
  const existing = getRequest(id);
  if (!existing) {
    throw new HttpError(404, "Request not found.");
  }

  db.query("DELETE FROM media_requests WHERE id = ?").run(id);
}

export function createRequest(input: CreateMediaRequest): MediaRequest {
  const requestedByUserId = input.requestedByUserId;
  if (!Number.isSafeInteger(requestedByUserId) || requestedByUserId <= 0) {
    throw new HttpError(400, "Request owner is required.");
  }

  if (!getUser(requestedByUserId)) {
    throw new HttpError(400, "Request owner is required.");
  }

  if (isRequestAvailable(input.mediaType, input.tmdbId, input.seasonNumbers)) {
    throw new HttpError(409, "This title is already available.");
  }

  const existingRequests = listRequestsForMedia(input.mediaType, input.tmdbId);
  const existing = existingRequests.find(
    (request) => request.requestedByUserId === requestedByUserId,
  );
  if (existing) {
    const seasonNumbers = mergedSeasonNumbers(existing.seasonNumbers, input.seasonNumbers);
    if (!sameSeasonNumbers(existing.seasonNumbers, seasonNumbers)) {
      db.query("UPDATE media_requests SET season_numbers = ? WHERE id = ?").run(
        optionalSeasonNumbersText(seasonNumbers),
        existing.id,
      );
      return getRequest(existing.id) ?? existing;
    }

    return existing;
  }

  const now = new Date().toISOString();
  const row = db
    .query(
      `
      INSERT INTO media_requests (
        media_type,
        tmdb_id,
        title,
        poster_path,
        backdrop_path,
        release_date,
        requested_by_user_id,
        season_numbers,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `,
    )
    .get(
      input.mediaType,
      input.tmdbId,
      input.title,
      input.posterPath ?? null,
      input.backdropPath ?? null,
      input.releaseDate ?? null,
      requestedByUserId ?? null,
      optionalSeasonNumbersText(input.seasonNumbers),
      now,
    ) as { id: number };

  const created = getRequest(row.id);
  if (!created) {
    throw new HttpError(500, "Created request could not be loaded.");
  }

  return created;
}

export function createAuthSession(user: AuthUser): NewAuthSession {
  pruneExpiredSessions();

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  db.query(
    `
    INSERT INTO sessions (
      token_hash,
      user_id,
      expires_at
    )
    VALUES (?, ?, ?)
  `,
  ).run(hashSessionToken(token), user.id, expiresAt);

  return {
    token,
    user,
    expiresAt,
  };
}

export function getAuthSession(token: string | undefined): AuthSession | undefined {
  if (!token) {
    return undefined;
  }

  const row = db
    .query(
      `
      SELECT user_id, expires_at
      FROM sessions
      WHERE token_hash = ? AND expires_at > ?
    `,
    )
    .get(hashSessionToken(token), new Date().toISOString()) as SessionRow | null;

  return row ? rowToSession(row) : undefined;
}

export function deleteAuthSession(token: string | undefined): void {
  if (!token) {
    return;
  }

  db.query("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
}

export function pruneExpiredSessions(): void {
  db.query("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
}

function ensurePrivateDataDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: privateDirectoryMode });
  chmodSync(path, privateDirectoryMode);
}

function ensurePrivateDatabaseFiles(databasePath: string): void {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(path)) {
      chmodSync(path, privateFileMode);
    }
  }
}

function createSchema(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jellyfin_user_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      is_administrator INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
      tmdb_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      poster_path TEXT,
      backdrop_path TEXT,
      release_date TEXT,
      requested_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      season_numbers TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(media_type, tmdb_id, requested_by_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_media_requests_requested_by_user_id
      ON media_requests(requested_by_user_id);

    CREATE TABLE IF NOT EXISTS available_media (
      media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
      tmdb_id INTEGER NOT NULL,
      jellyfin_item_id TEXT NOT NULL,
      PRIMARY KEY(media_type, tmdb_id)
    );

    CREATE INDEX IF NOT EXISTS idx_available_media_jellyfin_item_id
      ON available_media(jellyfin_item_id);

    CREATE TABLE IF NOT EXISTS arr_media (
      media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
      tmdb_id INTEGER NOT NULL,
      service_item_id INTEGER NOT NULL,
      title_slug TEXT NOT NULL,
      PRIMARY KEY(media_type, tmdb_id)
    );

    CREATE TABLE IF NOT EXISTS available_seasons (
      tmdb_id INTEGER NOT NULL,
      season_number INTEGER NOT NULL,
      PRIMARY KEY(tmdb_id, season_number)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
      ON sessions(expires_at);
  `);
}

function rowToRequest(row: RequestRow): MediaRequest {
  const seasonNumbers = optionalNumberArray(row.season_numbers);
  const availability = availabilityDetails(row.media_type, row.tmdb_id, seasonNumbers);

  return {
    id: row.id,
    mediaType: row.media_type,
    tmdbId: row.tmdb_id,
    title: row.title,
    posterPath: row.poster_path ?? undefined,
    backdropPath: row.backdrop_path ?? undefined,
    releaseDate: row.release_date ?? undefined,
    requestedByUserId: row.requested_by_user_id,
    requestedBy: row.requested_by,
    availability: availability.availability,
    seasonNumbers,
    availableSeasonNumbers: availability.availableSeasonNumbers,
    createdAt: row.created_at,
  };
}

function availabilityDetails(
  mediaType: MediaType,
  tmdbId: number,
  seasonNumbers?: number[],
): { availability: RequestAvailability; availableSeasonNumbers?: number[] } {
  if (mediaType !== "tv" || !seasonNumbers?.length) {
    return {
      availability: isMediaAvailable(mediaType, tmdbId) ? "available" : "requested",
    };
  }

  const requestedSeasons = [...new Set(seasonNumbers)].sort((a, b) => a - b);
  const availableSeasons = new Set(availableSeasonNumbers(tmdbId));
  const matchedSeasons = requestedSeasons.filter((seasonNumber) =>
    availableSeasons.has(seasonNumber),
  );

  if (matchedSeasons.length === 0) {
    return { availability: "requested" };
  }

  return {
    availability: matchedSeasons.length === requestedSeasons.length ? "available" : "requested",
    availableSeasonNumbers: matchedSeasons,
  };
}

function rowToSession(row: SessionRow): AuthSession {
  const user = getUser(row.user_id);
  if (!user) {
    throw new HttpError(401, "Session user not found.");
  }

  return {
    user,
    expiresAt: row.expires_at,
  };
}

function rowToUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    jellyfinUserId: row.jellyfin_user_id,
    name: row.name,
    isAdministrator: Boolean(row.is_administrator),
  };
}

function rowToAdminUser(row: AdminUserRow): AdminUser {
  return {
    ...rowToUser(row),
    requestCount: row.request_count,
  };
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getSetting(key: string): string | undefined {
  const row = db.query("SELECT value FROM app_settings WHERE key = ?").get(key) as {
    value: string;
  } | null;
  return row?.value;
}

function setSetting(key: string, value: string): void {
  db.query(
    `
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value
  `,
  ).run(key, value);
}

function deleteSetting(key: IntegrationSettingKey): void {
  db.query("DELETE FROM app_settings WHERE key = ?").run(key);
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalNumberText(value: unknown): string | undefined {
  const number = optionalNumber(value);
  return number === undefined ? undefined : String(number);
}

function optionalSeasonNumbersText(value: number[] | undefined): string | null {
  if (!value?.length) {
    return null;
  }

  return JSON.stringify([...new Set(value)].sort((a, b) => a - b));
}

function mergedSeasonNumbers(
  existing: number[] | undefined,
  next: number[] | undefined,
): number[] | undefined {
  if (!existing?.length && !next?.length) {
    return undefined;
  }

  return [...new Set([...(existing ?? []), ...(next ?? [])])].sort((a, b) => a - b);
}

function sameSeasonNumbers(a: number[] | undefined, b: number[] | undefined): boolean {
  const first = a ?? [];
  const second = b ?? [];
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function optionalNumberArray(value: unknown): number[] | undefined {
  if (!value) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is number => Number.isInteger(item) && item >= 0);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    const seasonNumbers = Array.isArray(parsed)
      ? parsed.filter((item): item is number => Number.isInteger(item) && item >= 0)
      : [];
    return seasonNumbers.length > 0 ? seasonNumbers : undefined;
  } catch {
    return undefined;
  }
}
