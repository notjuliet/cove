import type { AuthUser, CreateMediaRequest, MediaType, SearchKind } from "../shared/types";
import { config } from "./config";
import {
  clearSessionCookie,
  makeSessionCookie,
  sessionCookieName,
  shouldUseSecureCookies,
} from "./cookies";
import type { IntegrationSettingKey, IntegrationSettingsInput } from "./db";
import {
  adminIntegrationSettings,
  clearIntegrationSettings,
  completeSetup,
  countRequests,
  createAuthSession,
  createRequest,
  deleteAuthSession,
  deleteRequest,
  getAuthSession,
  getJellyfinItemUrlForMedia,
  getPublicOrigin,
  getRequest,
  getUser,
  hasCompletedSetup,
  isRequestAvailable,
  listRequests,
  listRequestsForMedia,
  listUsers,
  reconcileJellyfinUsers,
  saveIntegrationSettings,
  searchAvailabilityDetails,
  settingsSummary,
  upsertArrMediaReference,
  upsertJellyfinUser,
} from "./db";
import { HttpError, errorToResponse } from "./errors";
import { startBackgroundJobs, triggerJellyfinFullAvailabilitySync } from "./jobs";
import { logger } from "./logger";
import { requireTrustedOrigin } from "./request-security";
import { applySecurityHeaders } from "./security-headers";
import {
  getArrMediaUrl,
  getArrOptions,
  submitMovieToRadarr,
  submitSeriesToSonarr,
} from "./services/arr";
import {
  authenticateJellyfin,
  authenticateJellyfinAt,
  getJellyfinUsers,
  getJellyfinUserAvatar,
  syncJellyfinAvailability,
} from "./services/jellyfin";
import { getTmdbTvDetails, searchTmdb } from "./services/tmdb";
import { logFirstRunSetupToken, verifySetupToken } from "./setup";
import { serveClient } from "./static";
import {
  normalizeUrl,
  optionalBearerToken,
  optionalPositiveInteger,
  optionalText as text,
  requiredOrigin,
  requiredUrl,
} from "./validate";

export const maxRequestBodyBytes = 64 * 1024;

const maxSearchQueryChars = 200;
const maxUsernameChars = 256;
const maxPasswordChars = 1024;
const maxTitleChars = 500;
const maxMediaPathChars = 500;
const maxReleaseDateChars = 64;
const maxSeasonSelections = 1000;
const defaultRequestLimit = 20;
const maxRequestLimit = 100;
const maxRequestOffset = 1_000_000;

if (import.meta.main) {
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    maxRequestBodySize: maxRequestBodyBytes,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname.startsWith("/api")) {
        return handleApi(request, url);
      }

      return serveClient(url.pathname);
    },
  });

  logger.info(`Cove listening on http://${server.hostname}:${server.port}`);
  logFirstRunSetupToken();
  startBackgroundJobs();
}

export async function handleApi(request: Request, url: URL): Promise<Response> {
  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: applySecurityHeaders(new Headers()) });
    }

    if (!isFirstRunSetupRequest(request, url)) {
      requireTrustedOrigin(request, url, getPublicOrigin());
    }

    return await routeApi(request, url);
  } catch (error) {
    return errorToResponse(error);
  }
}

async function routeApi(request: Request, url: URL): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({ ok: true, setupRequired: !hasCompletedSetup() });
  }

  if (request.method === "POST" && url.pathname === "/api/setup") {
    if (hasCompletedSetup()) {
      throw new HttpError(409, "Cove setup is already complete.");
    }

    const payload = parseSetupPayload(await readJson(request));
    if (!verifySetupToken(payload.setupToken)) {
      throw new HttpError(403, "Invalid setup token.");
    }

    const login = await authenticateJellyfinAt(
      payload.jellyfinUrl,
      payload.username,
      payload.password,
    );
    if (!login.user.isAdministrator) {
      throw new HttpError(403, "Setup requires a Jellyfin administrator account.");
    }

    saveIntegrationSettings({
      publicOrigin: payload.publicOrigin,
      jellyfinUrl: payload.jellyfinUrl,
      jellyfinApiKey: payload.jellyfinApiKey,
      tmdbToken: payload.tmdbToken,
    });
    completeSetup();
    if (payload.jellyfinApiKey) {
      triggerJellyfinFullAvailabilitySync("first-run setup");
    }

    const user = upsertJellyfinUser(login.user);
    const session = createAuthSession(user);

    return json(
      { user: session.user, settings: settingsSummary() },
      {
        headers: {
          "Set-Cookie": makeSessionCookie(
            session.token,
            shouldUseSecureCookies(request, url, getPublicOrigin()),
          ),
        },
      },
    );
  }

  if (!hasCompletedSetup()) {
    throw new HttpError(428, "Cove setup is required.");
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    return json({ user: getCurrentSession(request)?.user ?? null });
  }

  if (url.pathname === "/api/admin/settings") {
    const currentUser = getCurrentUser(request);
    requireAdmin(currentUser);

    if (request.method === "GET") {
      return json({ settings: adminIntegrationSettings() });
    }

    if (request.method === "PUT") {
      const payload = parseAdminSettingsPayload(await readJson(request));
      clearIntegrationSettings(payload.clearKeys);
      saveIntegrationSettings(payload.values);

      return json({
        settings: adminIntegrationSettings(),
      });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/admin/jellyfin/sync") {
    const currentUser = getCurrentUser(request);
    requireAdmin(currentUser);

    return json({
      result: await syncJellyfinAvailability(),
    });
  }

  if (url.pathname === "/api/admin/users") {
    const currentUser = getCurrentUser(request);
    requireAdmin(currentUser);

    if (request.method === "GET") {
      return json({ users: listUsers() });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/admin/users/sync") {
    const currentUser = getCurrentUser(request);
    requireAdmin(currentUser);

    const syncedUsers = await getJellyfinUsers();
    const result = reconcileJellyfinUsers(syncedUsers, currentUser.id);

    return json({
      ...result,
      users: listUsers(),
    });
  }

  const arrOptionsMatch = url.pathname.match(/^\/api\/admin\/(radarr|sonarr)\/options$/);
  if (request.method === "POST" && arrOptionsMatch) {
    const currentUser = getCurrentUser(request);
    requireAdmin(currentUser);

    const service = arrOptionsMatch[1] as "radarr" | "sonarr";
    const input = parseConnectionPayload(await readJson(request));
    return json({
      options: await getArrOptions(service, input),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/jellyfin") {
    const credentials = parseLoginPayload(await readJson(request));
    const login = await authenticateJellyfin(credentials.username, credentials.password);
    const user = upsertJellyfinUser(login.user);
    const session = createAuthSession(user);

    return json(
      { user: session.user },
      {
        headers: {
          "Set-Cookie": makeSessionCookie(
            session.token,
            shouldUseSecureCookies(request, url, getPublicOrigin()),
          ),
        },
      },
    );
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    deleteAuthSession(getSessionToken(request));

    return json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": clearSessionCookie(shouldUseSecureCookies(request, url, getPublicOrigin())),
        },
      },
    );
  }

  const userAvatarMatch = url.pathname.match(/^\/api\/users\/(\d+)\/avatar$/);
  if (request.method === "GET" && userAvatarMatch) {
    const currentUser = getCurrentUser(request);
    requireUser(currentUser);

    const requestedUser = getUser(Number(userAvatarMatch[1]));
    if (!requestedUser || (!currentUser.isAdministrator && requestedUser.id !== currentUser.id)) {
      throw new HttpError(404, "User not found.");
    }

    const avatar = await getJellyfinUserAvatar(requestedUser.jellyfinUserId);
    const headers = applySecurityHeaders(new Headers());
    headers.set("Cache-Control", "private, max-age=3600");
    headers.set("Content-Type", avatar.contentType);

    return new Response(avatar.body, { headers });
  }

  if (request.method === "GET" && url.pathname === "/api/search") {
    requireUser(getCurrentUser(request));

    const query = boundedText(url.searchParams.get("q"), "Search query", maxSearchQueryChars) ?? "";
    const kind = parseSearchKind(url.searchParams.get("type") ?? "multi");
    return json({
      results: (await searchTmdb(query, kind)).map((item) => ({
        ...item,
        ...searchAvailabilityDetails(item.mediaType, item.tmdbId),
      })),
    });
  }

  const jellyfinMediaMatch = url.pathname.match(/^\/api\/media\/(movie|tv)\/(\d+)\/jellyfin$/);
  if (request.method === "GET" && jellyfinMediaMatch) {
    requireUser(getCurrentUser(request));

    const jellyfinUrl = getJellyfinItemUrlForMedia(
      jellyfinMediaMatch[1] as MediaType,
      Number(jellyfinMediaMatch[2]),
    );
    if (!jellyfinUrl) {
      throw new HttpError(404, "Media is not available in Jellyfin.");
    }

    return redirect(jellyfinUrl);
  }

  const arrMediaMatch = url.pathname.match(/^\/api\/media\/(movie|tv)\/(\d+)\/arr$/);
  if (request.method === "GET" && arrMediaMatch) {
    const currentUser = getCurrentUser(request);
    requireUser(currentUser);

    const mediaType = arrMediaMatch[1] as MediaType;
    const tmdbId = Number(arrMediaMatch[2]);
    const canManage =
      currentUser.isAdministrator ||
      listRequestsForMedia(mediaType, tmdbId).some(
        (mediaRequest) => mediaRequest.requestedByUserId === currentUser.id,
      );
    if (!canManage) {
      throw new HttpError(404, "Media request not found.");
    }

    const arrUrl = getArrMediaUrl(mediaType, tmdbId);
    if (!arrUrl) {
      throw new HttpError(404, "Media is not managed by Radarr or Sonarr.");
    }

    return redirect(arrUrl);
  }

  const tmdbDetailsMatch = url.pathname.match(/^\/api\/tmdb\/tv\/(\d+)$/);
  if (request.method === "GET" && tmdbDetailsMatch) {
    requireUser(getCurrentUser(request));

    const item = await getTmdbTvDetails(Number(tmdbDetailsMatch[1]));
    return json({
      item: {
        ...item,
        ...searchAvailabilityDetails(item.mediaType, item.tmdbId),
      },
    });
  }

  if (url.pathname === "/api/requests") {
    if (request.method === "GET") {
      const currentUser = getCurrentUser(request);
      requireUser(currentUser);

      return json(listVisibleRequestPage(currentUser, parseRequestPageOptions(url)));
    }

    if (request.method === "POST") {
      const currentUser = getCurrentUser(request);
      requireUser(currentUser);

      const payload = parseCreateRequest(await readJson(request), currentUser);
      const existingRequests = listRequestsForMedia(payload.mediaType, payload.tmdbId);
      if (!isRequestAvailable(payload.mediaType, payload.tmdbId, payload.seasonNumbers)) {
        const nextSeasonNumbers = nextRequestedSeasonNumbers(
          payload.mediaType,
          existingRequests,
          payload.seasonNumbers,
        );
        if (shouldSubmitRequest(payload.mediaType, existingRequests, nextSeasonNumbers)) {
          await submitRequestToService({ ...payload, seasonNumbers: nextSeasonNumbers });
        }
      }

      return json({ request: createRequest(payload) }, { status: 201 });
    }
  }

  const requestMatch = url.pathname.match(/^\/api\/requests\/(\d+)$/);
  if (requestMatch && request.method === "DELETE") {
    const mediaRequest = getVisibleRequest(Number(requestMatch[1]), getCurrentUser(request));
    deleteRequest(mediaRequest.id);
    return json({ ok: true });
  }

  throw new HttpError(404, "Route not found.");
}

function shouldSubmitRequest(
  mediaType: MediaType,
  existingRequests: CreateMediaRequest[],
  nextSeasonNumbers: number[] | undefined,
): boolean {
  if (existingRequests.length === 0) {
    return true;
  }

  if (mediaType === "movie") {
    return false;
  }

  return requestedSeasonSelectionExpands(
    aggregateRequestedSeasonNumbers(existingRequests),
    nextSeasonNumbers,
  );
}

function nextRequestedSeasonNumbers(
  mediaType: MediaType,
  existingRequests: CreateMediaRequest[],
  requestedSeasonNumbers: number[] | undefined,
): number[] | undefined {
  if (mediaType !== "tv") {
    return undefined;
  }

  return aggregateRequestedSeasonNumbers([
    ...existingRequests,
    { seasonNumbers: requestedSeasonNumbers },
  ]);
}

function aggregateRequestedSeasonNumbers(
  requests: Array<Pick<CreateMediaRequest, "seasonNumbers">>,
): number[] | undefined {
  const seasons = new Set<number>();
  for (const request of requests) {
    if (!request.seasonNumbers?.length) {
      return undefined;
    }

    for (const seasonNumber of request.seasonNumbers) {
      seasons.add(seasonNumber);
    }
  }

  return [...seasons].sort((a, b) => a - b);
}

function requestedSeasonSelectionExpands(
  before: number[] | undefined,
  after: number[] | undefined,
): boolean {
  if (before === undefined) {
    return false;
  }

  if (after === undefined) {
    return true;
  }

  const beforeSet = new Set(before);
  return after.some((seasonNumber) => !beforeSet.has(seasonNumber));
}

async function submitRequestToService(request: CreateMediaRequest): Promise<void> {
  const reference =
    request.mediaType === "movie"
      ? await submitMovieToRadarr(request.tmdbId)
      : await submitSeriesToSonarr(request.tmdbId, request.seasonNumbers);
  upsertArrMediaReference(reference);
}

function isFirstRunSetupRequest(request: Request, url: URL): boolean {
  return request.method === "POST" && url.pathname === "/api/setup" && !hasCompletedSetup();
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "Expected an application/json request body.");
  }

  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > maxRequestBodyBytes) {
    throw new HttpError(413, "Request body is too large.");
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    throw new HttpError(400, "Expected a JSON request body.");
  }

  if (new TextEncoder().encode(body).byteLength > maxRequestBodyBytes) {
    throw new HttpError(413, "Request body is too large.");
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new HttpError(400, "Expected a JSON request body.");
  }
}

function parseLoginPayload(payload: unknown): { username: string; password: string } {
  if (!payload || typeof payload !== "object") {
    throw new HttpError(400, "Expected a login object.");
  }

  const data = payload as Record<string, unknown>;
  const username = boundedText(data.username, "Jellyfin username", maxUsernameChars);
  const password = boundedString(data.password, "Jellyfin password", maxPasswordChars);

  if (!username || !password) {
    throw new HttpError(400, "Jellyfin username and password are required.");
  }

  return { username, password };
}

function parseSetupPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    throw new HttpError(400, "Expected a setup object.");
  }

  const data = payload as Record<string, unknown>;
  const setupToken = text(data.setupToken);
  const publicOrigin = requiredOrigin(data.publicOrigin, "Public URL");
  const jellyfinUrl = normalizeUrl(data.jellyfinUrl);
  const username = boundedText(data.username, "Jellyfin username", maxUsernameChars);
  const password = boundedString(data.password, "Jellyfin password", maxPasswordChars);
  const jellyfinApiKey = text(data.jellyfinApiKey);
  const tmdbToken = text(data.tmdbToken)?.replace(/^Bearer\s+/i, "");

  if (!setupToken || !jellyfinUrl || !username || !password || !tmdbToken) {
    throw new HttpError(
      400,
      "Setup token, Jellyfin URL, Jellyfin login, and TMDB token are required.",
    );
  }

  return {
    setupToken,
    publicOrigin,
    jellyfinUrl,
    jellyfinApiKey,
    username,
    password,
    tmdbToken,
  };
}

function parseAdminSettingsPayload(payload: unknown): {
  values: IntegrationSettingsInput;
  clearKeys: IntegrationSettingKey[];
} {
  if (!payload || typeof payload !== "object") {
    throw new HttpError(400, "Expected a settings object.");
  }

  const data = payload as Record<string, unknown>;
  const values: IntegrationSettingsInput = {
    publicOrigin: requiredOrigin(data.publicOrigin, "Public URL"),
    jellyfinUrl: requiredUrl(data.jellyfinUrl, "Jellyfin URL"),
  };
  const clearKeys: IntegrationSettingKey[] = [];

  const tmdbToken = optionalBearerToken(data.tmdbToken);
  if (tmdbToken) {
    values.tmdbToken = tmdbToken;
  }

  const jellyfinApiKey = text(data.jellyfinApiKey);
  if (jellyfinApiKey) {
    values.jellyfinApiKey = jellyfinApiKey;
  }

  const radarrUrl = normalizeUrl(data.radarrUrl);
  if (radarrUrl) {
    values.radarrUrl = radarrUrl;
    const radarrApiKey = text(data.radarrApiKey);
    const radarrRootFolderPath = text(data.radarrRootFolderPath);
    const radarrQualityProfileId = optionalPositiveInteger(
      data.radarrQualityProfileId,
      "Radarr quality profile ID",
    );

    if (radarrApiKey) {
      values.radarrApiKey = radarrApiKey;
    }
    if (radarrRootFolderPath) {
      values.radarrRootFolderPath = radarrRootFolderPath;
    } else {
      clearKeys.push("radarr.rootFolderPath");
    }
    if (radarrQualityProfileId) {
      values.radarrQualityProfileId = radarrQualityProfileId;
    } else {
      clearKeys.push("radarr.qualityProfileId");
    }
  } else {
    clearKeys.push(
      "radarr.url",
      "radarr.apiKey",
      "radarr.rootFolderPath",
      "radarr.qualityProfileId",
    );
  }

  const sonarrUrl = normalizeUrl(data.sonarrUrl);
  if (sonarrUrl) {
    values.sonarrUrl = sonarrUrl;
    const sonarrApiKey = text(data.sonarrApiKey);
    const sonarrRootFolderPath = text(data.sonarrRootFolderPath);
    const sonarrAnimeRootFolderPath = text(data.sonarrAnimeRootFolderPath);
    const sonarrQualityProfileId = optionalPositiveInteger(
      data.sonarrQualityProfileId,
      "Sonarr quality profile ID",
    );

    if (sonarrApiKey) {
      values.sonarrApiKey = sonarrApiKey;
    }
    if (sonarrRootFolderPath) {
      values.sonarrRootFolderPath = sonarrRootFolderPath;
    } else {
      clearKeys.push("sonarr.rootFolderPath");
    }
    if (sonarrAnimeRootFolderPath) {
      values.sonarrAnimeRootFolderPath = sonarrAnimeRootFolderPath;
    } else {
      clearKeys.push("sonarr.animeRootFolderPath");
    }
    if (sonarrQualityProfileId) {
      values.sonarrQualityProfileId = sonarrQualityProfileId;
    } else {
      clearKeys.push("sonarr.qualityProfileId");
    }
  } else {
    clearKeys.push(
      "sonarr.url",
      "sonarr.apiKey",
      "sonarr.rootFolderPath",
      "sonarr.animeRootFolderPath",
      "sonarr.qualityProfileId",
    );
  }

  return { values, clearKeys };
}

function parseConnectionPayload(payload: unknown): { url?: string; apiKey?: string } {
  if (!payload || typeof payload !== "object") {
    throw new HttpError(400, "Expected a connection object.");
  }

  const data = payload as Record<string, unknown>;
  return {
    url: normalizeUrl(data.url),
    apiKey: text(data.apiKey),
  };
}

function parseCreateRequest(payload: unknown, currentUser: AuthUser): CreateMediaRequest {
  if (!payload || typeof payload !== "object") {
    throw new HttpError(400, "Expected a request object.");
  }

  const data = payload as Record<string, unknown>;
  const mediaType = parseMediaType(data.mediaType);
  const tmdbId = Number(data.tmdbId);
  const title = boundedText(data.title, "Title", maxTitleChars);

  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new HttpError(400, "Invalid TMDB ID.");
  }

  if (!title) {
    throw new HttpError(400, "Title is required.");
  }

  return {
    mediaType,
    tmdbId,
    title,
    requestedByUserId: currentUser.id,
    posterPath: boundedText(data.posterPath, "Poster path", maxMediaPathChars),
    backdropPath: boundedText(data.backdropPath, "Backdrop path", maxMediaPathChars),
    releaseDate: boundedText(data.releaseDate, "Release date", maxReleaseDateChars),
    seasonNumbers: mediaType === "tv" ? seasonNumberArray(data.seasonNumbers) : undefined,
  };
}

function parseSearchKind(value: unknown): SearchKind {
  if (value === "movie" || value === "tv" || value === "multi") {
    return value;
  }

  throw new HttpError(400, "Invalid search type.");
}

function parseMediaType(value: unknown): MediaType {
  if (value === "movie" || value === "tv") {
    return value;
  }

  throw new HttpError(400, "Invalid media type.");
}

function seasonNumberArray(value: unknown): number[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new HttpError(400, "Season numbers must be an array.");
  }

  if (value.length > maxSeasonSelections) {
    throw new HttpError(400, "Too many seasons were selected.");
  }

  const parsed = value.map(Number);
  if (parsed.some((seasonNumber) => !Number.isInteger(seasonNumber) || seasonNumber < 0)) {
    throw new HttpError(400, "Season numbers must be whole numbers.");
  }

  return [...new Set(parsed)];
}

function parseRequestPageOptions(url: URL): {
  limit: number;
  offset: number;
  requestedByUserId?: number;
} {
  return {
    limit: boundedQueryInteger(
      url.searchParams.get("limit"),
      "Request limit",
      1,
      maxRequestLimit,
      defaultRequestLimit,
    ),
    offset: boundedQueryInteger(
      url.searchParams.get("offset"),
      "Request offset",
      0,
      maxRequestOffset,
      0,
    ),
    requestedByUserId: optionalPositiveInteger(
      url.searchParams.get("requestedByUserId"),
      "Requested user ID",
    ),
  };
}

function listVisibleRequestPage(
  currentUser: AuthUser,
  options: { limit: number; offset: number; requestedByUserId?: number },
) {
  const requestedByUserId = currentUser.isAdministrator
    ? options.requestedByUserId
    : currentUser.id;
  const filter = { requestedByUserId };

  return {
    requests: listRequests({ ...filter, limit: options.limit, offset: options.offset }),
    total: countRequests(filter),
  };
}

function getVisibleRequest(id: number, currentUser: AuthUser | undefined) {
  requireUser(currentUser);

  const mediaRequest = getRequest(id);
  if (!mediaRequest) {
    throw new HttpError(404, "Request not found.");
  }

  if (!currentUser.isAdministrator && mediaRequest.requestedByUserId !== currentUser.id) {
    throw new HttpError(404, "Request not found.");
  }

  return mediaRequest;
}

function requireUser(currentUser: AuthUser | undefined): asserts currentUser is AuthUser {
  if (!currentUser) {
    throw new HttpError(401, "Sign in with Jellyfin first.");
  }
}

function requireAdmin(currentUser: AuthUser | undefined): asserts currentUser is AuthUser {
  requireUser(currentUser);

  if (!currentUser.isAdministrator) {
    throw new HttpError(403, "Admin access is required.");
  }
}

function getCurrentUser(request: Request): AuthUser | undefined {
  return getCurrentSession(request)?.user;
}

function getCurrentSession(request: Request) {
  return getAuthSession(getSessionToken(request));
}

function getSessionToken(request: Request): string | undefined {
  return parseCookies(request.headers.get("Cookie"))[sessionCookieName];
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) {
          return [part, ""];
        }

        return [part.slice(0, index), safeDecodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json");
  applySecurityHeaders(headers);

  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers,
  });
}

function redirect(url: string): Response {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("Location", url);
  applySecurityHeaders(headers);

  return new Response(null, { status: 302, headers });
}

function boundedText(value: unknown, label: string, maxChars: number): string | undefined {
  const parsed = text(value);
  if (parsed && parsed.length > maxChars) {
    throw new HttpError(400, `${label} is too long.`);
  }

  return parsed;
}

function boundedString(value: unknown, label: string, maxChars: number): string {
  if (typeof value !== "string") {
    return "";
  }

  if (value.length > maxChars) {
    throw new HttpError(400, `${label} is too long.`);
  }

  return value;
}

function boundedQueryInteger(
  value: string | null,
  label: string,
  minimum: number,
  maximum: number,
  defaultValue: number,
): number {
  if (value === null || value === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpError(400, `${label} must be between ${minimum} and ${maximum}.`);
  }

  return parsed;
}
