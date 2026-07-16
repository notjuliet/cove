import type { AuthUser, MediaType } from "../../shared/types";
import {
  getAvailableMediaByJellyfinItemId,
  getIntegrationSettings,
  replaceAvailableMedia,
  upsertAvailableMedia,
  type AvailableMediaInput,
  type AvailableSeasonInput,
} from "../db";
import { HttpError } from "../errors";
import { fetchWithTimeout } from "../http";
import { withConnectionInput } from "../validate";

type JellyfinUserRaw = {
  Id?: string;
  Name?: string;
  Policy?: {
    IsAdministrator?: boolean;
  };
};

type JellyfinAuthResponse = {
  AccessToken?: string;
  User?: JellyfinUserRaw;
};

type JellyfinUser = {
  id: string;
  name: string;
  isAdministrator: boolean;
};

export type JellyfinConnectionInput = {
  url?: string;
  apiKey?: string;
};

type JellyfinLibraryRaw = {
  Name?: string;
  ItemId?: string;
  CollectionType?: string;
};

type JellyfinLibrary = {
  id: string;
  name: string;
  collectionType: string;
};

type JellyfinItemRaw = {
  Id?: string;
  Name?: string;
  Type?: string;
  DateCreated?: string;
  IndexNumber?: number;
  SeriesId?: string;
  ProviderIds?: Record<string, string | number | null | undefined>;
};

type JellyfinItemsResponse = {
  Items?: JellyfinItemRaw[];
};

export type JellyfinLogin = {
  user: Omit<AuthUser, "id">;
};

export type JellyfinSyncResult = {
  availableCount: number;
};

export type JellyfinAvatar = {
  body: ArrayBuffer;
  contentType: string;
};

type JellyfinAvailability = {
  media: AvailableMediaInput[];
  seasons: AvailableSeasonInput[];
};

const jellyfinAuthHeader =
  'MediaBrowser Client="Cove", Device="Cove Web", DeviceId="cove-web", Version="0.1.0"';

export async function authenticateJellyfin(
  username: string,
  password: string,
): Promise<JellyfinLogin> {
  const jellyfinUrl = getIntegrationSettings().jellyfin.url;
  if (!jellyfinUrl) {
    throw new HttpError(503, "Jellyfin is not configured.");
  }

  return authenticateJellyfinAt(jellyfinUrl, username, password);
}

export async function authenticateJellyfinAt(
  jellyfinUrl: string,
  username: string,
  password: string,
): Promise<JellyfinLogin> {
  const response = await fetchWithTimeout(
    "Jellyfin",
    `${jellyfinUrl.replace(/\/+$/, "")}/Users/AuthenticateByName`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: jellyfinAuthHeader,
        "Content-Type": "application/json",
        "X-Emby-Authorization": jellyfinAuthHeader,
      },
      body: JSON.stringify({
        Username: username,
        Pw: password,
      }),
    },
  );

  if (!response.ok) {
    const message =
      response.status === 401
        ? "Jellyfin rejected those credentials."
        : `Jellyfin returned ${response.status}.`;
    throw new HttpError(response.status, message);
  }

  const data = (await response.json()) as JellyfinAuthResponse;
  const user = mapJellyfinUser(data.User);

  if (!data.AccessToken || !user) {
    throw new HttpError(502, "Jellyfin returned an incomplete login response.");
  }

  return {
    user: {
      jellyfinUserId: user.id,
      name: user.name,
      isAdministrator: user.isAdministrator,
    },
  };
}

export async function getJellyfinLibraries(
  input: JellyfinConnectionInput = {},
): Promise<JellyfinLibrary[]> {
  const libraries = await jellyfinFetch<JellyfinLibraryRaw[]>("/Library/VirtualFolders", {}, input);

  return libraries.flatMap((library) => {
    const id = library.ItemId?.trim();
    const name = library.Name?.trim();
    const collectionType = library.CollectionType?.trim().toLowerCase();
    if (!id || !name || !collectionType || !isSupportedJellyfinLibraryType(collectionType)) {
      return [];
    }

    return [
      {
        id,
        name,
        collectionType,
      },
    ];
  });
}

export async function getJellyfinUsers(
  input: JellyfinConnectionInput = {},
): Promise<Omit<AuthUser, "id">[]> {
  const users = await jellyfinFetch<JellyfinUserRaw[]>("/Users", {}, input);

  return users.flatMap((rawUser) => {
    const user = mapJellyfinUser(rawUser);
    return user
      ? [
          {
            jellyfinUserId: user.id,
            name: user.name,
            isAdministrator: user.isAdministrator,
          },
        ]
      : [];
  });
}

function isSupportedJellyfinLibraryType(collectionType: string): boolean {
  return collectionType === "movies" || collectionType === "tvshows" || collectionType === "mixed";
}

export async function getJellyfinUserAvatar(jellyfinUserId: string): Promise<JellyfinAvatar> {
  const settings = getIntegrationSettings().jellyfin;
  if (!settings.url || !settings.apiKey) {
    throw new HttpError(503, "Jellyfin API key is not configured.");
  }

  const url = new URL(`${settings.url}/Users/${encodeURIComponent(jellyfinUserId)}/Images/Primary`);
  url.searchParams.set("maxWidth", "96");
  url.searchParams.set("maxHeight", "96");
  url.searchParams.set("quality", "90");

  const response = await fetchWithTimeout("Jellyfin", url, {
    headers: {
      Accept: "image/*",
      "X-Emby-Token": settings.apiKey,
    },
  });

  if (response.status === 404) {
    throw new HttpError(404, "Jellyfin user avatar not found.");
  }

  if (!response.ok) {
    throw new HttpError(response.status, `Jellyfin returned ${response.status}.`);
  }

  return {
    body: await response.arrayBuffer(),
    contentType: safeAvatarContentType(response.headers.get("Content-Type")),
  };
}

function safeAvatarContentType(value: string | null): string {
  const contentType = value?.split(";")[0]?.trim().toLowerCase();
  if (!contentType) {
    return "image/jpeg";
  }

  if (contentType.startsWith("image/") && contentType !== "image/svg+xml") {
    return contentType;
  }

  throw new HttpError(502, "Jellyfin returned an unsupported avatar image type.");
}

export async function syncJellyfinAvailability(): Promise<JellyfinSyncResult> {
  const availableMedia = new Map<string, AvailableMediaInput>();
  const availableSeasons = new Map<string, AvailableSeasonInput>();
  for (const library of await getJellyfinLibraries()) {
    const availability = await getLibraryAvailability(library.id);
    for (const item of availability.media) {
      availableMedia.set(`${item.mediaType}:${item.tmdbId}`, item);
    }
    for (const season of availability.seasons) {
      availableSeasons.set(`${season.tmdbId}:${season.seasonNumber}`, season);
    }
  }

  return replaceAvailableMedia([...availableMedia.values()], [...availableSeasons.values()]);
}

export async function syncRecentlyAddedJellyfinAvailability(
  since: string,
): Promise<JellyfinSyncResult> {
  const sinceDate = new Date(since);
  if (!Number.isFinite(sinceDate.getTime())) {
    throw new HttpError(500, "Recent Jellyfin scan timestamp is invalid.");
  }

  const availableMedia = new Map<string, AvailableMediaInput>();
  const availableSeasons = new Map<string, AvailableSeasonInput>();
  for (const library of await getJellyfinLibraries()) {
    const availability = await getRecentlyAddedAvailability(library.id, sinceDate);
    for (const item of availability.media) {
      availableMedia.set(`${item.mediaType}:${item.tmdbId}`, item);
    }
    for (const season of availability.seasons) {
      availableSeasons.set(`${season.tmdbId}:${season.seasonNumber}`, season);
    }
  }

  return upsertAvailableMedia([...availableMedia.values()], [...availableSeasons.values()]);
}

async function getLibraryAvailability(libraryId: string): Promise<JellyfinAvailability> {
  const limit = 200;
  const items: JellyfinItemRaw[] = [];

  for (let startIndex = 0; ; startIndex += limit) {
    const data = await jellyfinFetch<JellyfinItemsResponse>("/Items", {
      ParentId: libraryId,
      Recursive: "true",
      IncludeItemTypes: "Movie,Series,Season",
      Fields: "ProviderIds",
      StartIndex: String(startIndex),
      Limit: String(limit),
    });
    const page = data.Items ?? [];
    items.push(...page);

    if (page.length < limit) {
      return mapJellyfinAvailability(items);
    }
  }
}

async function getRecentlyAddedAvailability(
  libraryId: string,
  since: Date,
): Promise<JellyfinAvailability> {
  const limit = 200;
  const items: JellyfinItemRaw[] = [];

  for (let startIndex = 0; ; startIndex += limit) {
    const data = await jellyfinFetch<JellyfinItemsResponse>("/Items", {
      ParentId: libraryId,
      Recursive: "true",
      IncludeItemTypes: "Movie,Series,Season",
      Fields: "ProviderIds,DateCreated",
      SortBy: "DateCreated",
      SortOrder: "Descending",
      StartIndex: String(startIndex),
      Limit: String(limit),
    });
    const page = data.Items ?? [];

    for (const item of page) {
      if (isAtOrBefore(item.DateCreated, since)) {
        return mapJellyfinAvailability(items);
      }

      items.push(item);
    }

    if (page.length < limit) {
      return mapJellyfinAvailability(items);
    }
  }
}

async function jellyfinFetch<T>(
  path: string,
  params: Record<string, string> = {},
  input: JellyfinConnectionInput = {},
): Promise<T> {
  const settings = withConnectionInput(getIntegrationSettings().jellyfin, input);
  if (!settings.url || !settings.apiKey) {
    throw new HttpError(503, "Jellyfin API key is not configured.");
  }

  const url = new URL(`${settings.url}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetchWithTimeout("Jellyfin", url, {
    headers: {
      Accept: "application/json",
      "X-Emby-Token": settings.apiKey,
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, `Jellyfin returned ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

function isAtOrBefore(value: string | undefined, since: Date): boolean {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date <= since;
}

function mapAvailableMedia(item: JellyfinItemRaw): AvailableMediaInput | undefined {
  const mediaType = jellyfinItemMediaType(item.Type);
  const tmdbId = tmdbProviderId(item.ProviderIds);
  const jellyfinItemId = item.Id?.trim();

  if (!mediaType || !tmdbId || !jellyfinItemId) {
    return undefined;
  }

  return {
    mediaType,
    tmdbId,
    jellyfinItemId,
  };
}

function mapJellyfinAvailability(items: JellyfinItemRaw[]): JellyfinAvailability {
  const media = items.flatMap((item) => {
    const available = mapAvailableMedia(item);
    return available ? [available] : [];
  });
  const seriesTmdbByJellyfinId = new Map(
    media
      .filter((item) => item.mediaType === "tv")
      .map((item) => [item.jellyfinItemId, item.tmdbId]),
  );
  const seasons = items.flatMap((item) => {
    const available = mapAvailableSeason(item, seriesTmdbByJellyfinId);
    return available ? [available] : [];
  });

  return { media, seasons };
}

function mapAvailableSeason(
  item: JellyfinItemRaw,
  seriesTmdbByJellyfinId: Map<string, number>,
): AvailableSeasonInput | undefined {
  if (item.Type !== "Season") {
    return undefined;
  }

  const seriesId = item.SeriesId?.trim();
  const seasonNumber = item.IndexNumber;
  if (
    !seriesId ||
    !Number.isInteger(seasonNumber) ||
    seasonNumber === undefined ||
    seasonNumber < 0
  ) {
    return undefined;
  }

  const tmdbId =
    seriesTmdbByJellyfinId.get(seriesId) ?? getAvailableMediaByJellyfinItemId(seriesId)?.tmdbId;
  if (!tmdbId) {
    return undefined;
  }

  return {
    tmdbId,
    seasonNumber,
  };
}

function jellyfinItemMediaType(type: string | undefined): MediaType | undefined {
  if (type === "Movie") {
    return "movie";
  }

  if (type === "Series") {
    return "tv";
  }

  return undefined;
}

function tmdbProviderId(providerIds: JellyfinItemRaw["ProviderIds"]): number | undefined {
  if (!providerIds) {
    return undefined;
  }

  const value = Object.entries(providerIds).find(([key]) => key.toLowerCase() === "tmdb")?.[1];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function mapJellyfinUser(user: JellyfinUserRaw | undefined): JellyfinUser | undefined {
  if (!user?.Id || !user.Name) {
    return undefined;
  }

  return {
    id: user.Id,
    name: user.Name,
    isAdministrator: Boolean(user.Policy?.IsAdministrator),
  };
}
