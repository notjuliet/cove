import type { ArrServiceOptions, MediaType } from "../../shared/types";
import { getArrMediaReference, getIntegrationSettings, type ArrMediaReference } from "../db";
import { HttpError } from "../errors";
import { fetchWithTimeout } from "../http";
import { withConnectionInput } from "../validate";
import { getTvDetails, type TmdbTvDetails } from "./tmdb";

type ArrConfig = {
  url?: string;
  apiKey?: string;
  rootFolderPath?: string;
  animeRootFolderPath?: string;
  qualityProfileId?: number;
};

export type ArrConnectionInput = {
  url?: string;
  apiKey?: string;
};

type ReadyArrConfig = ArrConfig & {
  url: string;
  apiKey: string;
  rootFolderPath: string;
  qualityProfileId: number;
};

type ConnectedArrConfig = ArrConfig & {
  url: string;
  apiKey: string;
};

type ArrQualityProfileRaw = {
  id?: number;
  name?: string;
};

type ArrRootFolderRaw = {
  path?: string;
  freeSpace?: number;
};

type SonarrSeriesRaw = Record<string, unknown> & {
  id?: number;
  seasons?: unknown[];
};

type RadarrMovieRaw = Record<string, unknown> & {
  id?: number;
  hasFile?: boolean;
};

export async function getArrOptions(
  service: "radarr" | "sonarr",
  input: ArrConnectionInput = {},
): Promise<ArrServiceOptions> {
  const label = service === "radarr" ? "Radarr" : "Sonarr";
  const config = withConnectionInput(getIntegrationSettings()[service], input);
  ensureReady(label, config, false);

  const [qualityProfiles, rootFolders] = await Promise.all([
    arrFetch<ArrQualityProfileRaw[]>(label, config.url!, config.apiKey!, "/api/v3/qualityprofile"),
    arrFetch<ArrRootFolderRaw[]>(label, config.url!, config.apiKey!, "/api/v3/rootfolder"),
  ]);

  return {
    qualityProfiles: mapQualityProfiles(qualityProfiles),
    rootFolders: mapRootFolders(rootFolders),
  };
}

export async function submitMovieToRadarr(tmdbId: number): Promise<ArrMediaReference> {
  const radarr = readyConfig("Radarr", getIntegrationSettings().radarr);
  const existingMovie = await findRadarrMovie(radarr, tmdbId);
  if (existingMovie) {
    return updateRadarrMovie(radarr, existingMovie, tmdbId);
  }

  const lookup = await arrFetch<Record<string, unknown>>(
    "Radarr",
    radarr.url,
    radarr.apiKey,
    `/api/v3/movie/lookup/tmdb?tmdbId=${tmdbId}`,
  );

  const payload = {
    ...lookup,
    rootFolderPath: radarr.rootFolderPath,
    qualityProfileId: radarr.qualityProfileId,
    monitored: true,
    addOptions: {
      monitor: "movieOnly",
      searchForMovie: false,
    },
  };

  const result = await arrFetch("Radarr", radarr.url, radarr.apiKey, "/api/v3/movie", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const reference = arrMediaReference("Radarr", "movie", tmdbId, result);
  await triggerRadarrSearch(radarr, reference.itemId);
  return reference;
}

export async function submitSeriesToSonarr(
  tmdbId: number,
  seasonNumbers: number[] | undefined,
): Promise<ArrMediaReference> {
  const sonarr = readyConfig("Sonarr", getIntegrationSettings().sonarr);

  const details = await getTvDetails(tmdbId);
  if (!details.externalIds.tvdb_id) {
    throw new HttpError(422, "TMDB did not return a TVDB ID for this series.");
  }

  const selectedSeasons = seasonNumberSet(seasonNumbers);
  const existingSeries = await findSonarrSeries(sonarr, details.externalIds.tvdb_id);
  if (existingSeries) {
    return updateSonarrSeries(sonarr, existingSeries, selectedSeasons, tmdbId);
  }

  const lookup = await arrFetch<unknown[]>(
    "Sonarr",
    sonarr.url,
    sonarr.apiKey,
    `/api/v3/series/lookup?term=${encodeURIComponent(`tvdb:${details.externalIds.tvdb_id}`)}`,
  );
  const series = Array.isArray(lookup) ? lookup[0] : lookup;

  if (!series || typeof series !== "object") {
    throw new HttpError(404, "Sonarr could not find this series.");
  }

  const payload: Record<string, unknown> = {
    ...(series as Record<string, unknown>),
    rootFolderPath: rootFolderPathForSeries(sonarr, details),
    qualityProfileId: sonarr.qualityProfileId,
    monitored: true,
    seasonFolder: true,
    addOptions: {
      searchForMissingEpisodes: false,
    },
  };

  if (Array.isArray(payload.seasons)) {
    payload.seasons = monitoredSeasons(payload.seasons, selectedSeasons, false);
  }

  const result = await arrFetch("Sonarr", sonarr.url, sonarr.apiKey, "/api/v3/series", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const reference = arrMediaReference("Sonarr", "tv", tmdbId, result);
  await triggerSonarrSearch(sonarr, reference.itemId, selectedSeasons ?? "all");
  return reference;
}

export function getArrMediaUrl(mediaType: MediaType, tmdbId: number): string | undefined {
  const settings = getIntegrationSettings();
  const config = mediaType === "movie" ? settings.radarr : settings.sonarr;
  const reference = getArrMediaReference(mediaType, tmdbId);
  if (!config.url || !reference) {
    return undefined;
  }

  const route = mediaType === "movie" ? "movie" : "series";
  return `${config.url}/${route}/${encodeURIComponent(reference.titleSlug)}`;
}

async function findRadarrMovie(
  radarr: ConnectedArrConfig,
  tmdbId: number,
): Promise<RadarrMovieRaw | undefined> {
  const existing = await arrFetch<unknown[]>(
    "Radarr",
    radarr.url,
    radarr.apiKey,
    `/api/v3/movie?tmdbId=${tmdbId}`,
  );
  const movie = Array.isArray(existing) ? existing[0] : existing;

  return movie && typeof movie === "object" ? (movie as RadarrMovieRaw) : undefined;
}

async function updateRadarrMovie(
  radarr: ReadyArrConfig,
  movie: RadarrMovieRaw,
  tmdbId: number,
): Promise<ArrMediaReference> {
  const movieId = Number(movie.id);
  if (!Number.isSafeInteger(movieId)) {
    throw new HttpError(502, "Radarr returned an existing movie without an ID.");
  }

  const result = await arrFetch("Radarr", radarr.url, radarr.apiKey, `/api/v3/movie/${movieId}`, {
    method: "PUT",
    body: JSON.stringify({ ...movie, monitored: true }),
  });

  if (movie.hasFile !== true) {
    await triggerRadarrSearch(radarr, movieId);
  }

  return arrMediaReference(
    "Radarr",
    "movie",
    tmdbId,
    result && typeof result === "object" ? { ...movie, ...result } : movie,
  );
}

async function findSonarrSeries(
  sonarr: ConnectedArrConfig,
  tvdbId: number,
): Promise<SonarrSeriesRaw | undefined> {
  const existing = await arrFetch<unknown[]>(
    "Sonarr",
    sonarr.url,
    sonarr.apiKey,
    `/api/v3/series?tvdbId=${tvdbId}`,
  );
  const series = Array.isArray(existing) ? existing[0] : existing;

  return series && typeof series === "object" ? (series as SonarrSeriesRaw) : undefined;
}

async function updateSonarrSeries(
  sonarr: ReadyArrConfig,
  series: SonarrSeriesRaw,
  selectedSeasons: Set<number> | undefined,
  tmdbId: number,
): Promise<ArrMediaReference> {
  const seriesId = Number(series.id);
  if (!Number.isSafeInteger(seriesId)) {
    throw new HttpError(502, "Sonarr returned an existing series without an ID.");
  }

  const payload: Record<string, unknown> = {
    ...series,
    monitored: true,
  };
  const searchSelection = sonarrSearchSelection(series.seasons, selectedSeasons);

  if (Array.isArray(series.seasons)) {
    payload.seasons = monitoredSeasons(series.seasons, selectedSeasons, true);
  }

  const result = await arrFetch("Sonarr", sonarr.url, sonarr.apiKey, `/api/v3/series/${seriesId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  if (searchSelection) {
    await triggerSonarrSearch(sonarr, seriesId, searchSelection);
  }
  return arrMediaReference(
    "Sonarr",
    "tv",
    tmdbId,
    result && typeof result === "object" ? { ...series, ...result } : series,
  );
}

function monitoredSeasons(
  seasons: unknown[],
  selectedSeasons: Set<number> | undefined,
  preserveMonitored: boolean,
): unknown[] {
  return seasons.map((season) => {
    if (!season || typeof season !== "object") {
      return season;
    }

    const seasonData = season as Record<string, unknown>;
    const seasonNumber = Number(seasonData.seasonNumber);
    return {
      ...seasonData,
      monitored: selectedSeasons
        ? selectedSeasons.has(seasonNumber) || (preserveMonitored && seasonData.monitored === true)
        : true,
    };
  });
}

async function triggerSonarrSearch(
  sonarr: ReadyArrConfig,
  seriesId: number,
  selection: Set<number> | "all",
): Promise<void> {
  if (selection === "all") {
    await arrFetch("Sonarr", sonarr.url, sonarr.apiKey, "/api/v3/command", {
      method: "POST",
      body: JSON.stringify({ name: "SeriesSearch", seriesId }),
    });
    return;
  }

  for (const seasonNumber of [...selection].sort((a, b) => a - b)) {
    await arrFetch("Sonarr", sonarr.url, sonarr.apiKey, "/api/v3/command", {
      method: "POST",
      body: JSON.stringify({ name: "SeasonSearch", seriesId, seasonNumber }),
    });
  }
}

async function triggerRadarrSearch(radarr: ReadyArrConfig, movieId: number): Promise<void> {
  await arrFetch("Radarr", radarr.url, radarr.apiKey, "/api/v3/command", {
    method: "POST",
    body: JSON.stringify({ name: "MoviesSearch", movieIds: [movieId] }),
  });
}

function sonarrSearchSelection(
  seasons: unknown[] | undefined,
  selectedSeasons: Set<number> | undefined,
): Set<number> | "all" | undefined {
  if (!Array.isArray(seasons)) {
    return selectedSeasons ?? "all";
  }

  if (!selectedSeasons) {
    return seasons.some((season) => seasonMonitored(season) === false) ? "all" : undefined;
  }

  const unmonitored = new Set<number>();
  for (const seasonNumber of selectedSeasons) {
    const season = seasons.find((item) => seasonNumberFor(item) === seasonNumber);
    if (seasonMonitored(season) !== true) {
      unmonitored.add(seasonNumber);
    }
  }

  return unmonitored.size > 0 ? unmonitored : undefined;
}

function seasonNumberFor(season: unknown): number | undefined {
  if (!season || typeof season !== "object") {
    return undefined;
  }

  const seasonNumber = Number((season as Record<string, unknown>).seasonNumber);
  return Number.isInteger(seasonNumber) ? seasonNumber : undefined;
}

function seasonMonitored(season: unknown): boolean | undefined {
  if (!season || typeof season !== "object") {
    return undefined;
  }

  const monitored = (season as Record<string, unknown>).monitored;
  return typeof monitored === "boolean" ? monitored : undefined;
}

function rootFolderPathForSeries(sonarr: ArrConfig, details: TmdbTvDetails): string | undefined {
  if (sonarr.animeRootFolderPath && isAnimeSeries(details)) {
    return sonarr.animeRootFolderPath;
  }

  return sonarr.rootFolderPath;
}

function isAnimeSeries(details: TmdbTvDetails): boolean {
  const labels = new Set(
    [...details.genres, ...details.keywords].map((value) => value.trim().toLowerCase()),
  );
  if (labels.has("anime")) {
    return true;
  }

  const isAnimated = labels.has("animation");
  const isJapanese =
    details.originalLanguage === "ja" ||
    details.originCountry.some((country) => country.toUpperCase() === "JP");
  return isAnimated && isJapanese;
}

function seasonNumberSet(values: number[] | undefined): Set<number> | undefined {
  const seasons = [
    ...new Set((values ?? []).filter((value) => Number.isInteger(value) && value >= 0)),
  ];
  return seasons.length > 0 ? new Set(seasons) : undefined;
}

function readyConfig(service: "Radarr" | "Sonarr", serviceConfig: ArrConfig): ReadyArrConfig {
  ensureReady(service, serviceConfig, true);
  return serviceConfig as ReadyArrConfig;
}

function arrMediaReference(
  service: "Radarr" | "Sonarr",
  mediaType: MediaType,
  tmdbId: number,
  item: unknown,
): ArrMediaReference {
  if (!item || typeof item !== "object") {
    throw new HttpError(502, `${service} returned an invalid media item.`);
  }

  const data = item as Record<string, unknown>;
  const itemId = Number(data.id);
  const titleSlug = typeof data.titleSlug === "string" ? data.titleSlug.trim() : "";
  if (!Number.isSafeInteger(itemId) || itemId <= 0 || !titleSlug) {
    throw new HttpError(502, `${service} returned a media item without an ID or title slug.`);
  }

  return { mediaType, tmdbId, itemId, titleSlug };
}

function ensureReady(
  service: "Radarr" | "Sonarr",
  serviceConfig: ArrConfig,
  requireComplete: boolean,
): void {
  const fields: Array<[string, unknown]> = [
    ["url", serviceConfig.url],
    ["api key", serviceConfig.apiKey],
  ];

  if (requireComplete) {
    fields.push(["root folder", serviceConfig.rootFolderPath]);
    fields.push(["quality profile", serviceConfig.qualityProfileId]);
  }

  const missing = fields.filter(([, value]) => !value).map(([label]) => label);

  if (missing.length > 0) {
    throw new HttpError(503, `${service} is missing ${missing.join(", ")} configuration.`);
  }
}

function mapQualityProfiles(items: ArrQualityProfileRaw[]): ArrServiceOptions["qualityProfiles"] {
  return items
    .map((item) => ({
      id: item.id,
      name: item.name?.trim(),
    }))
    .filter(
      (item): item is { id: number; name: string } =>
        Number.isSafeInteger(item.id) && Boolean(item.name),
    );
}

function mapRootFolders(items: ArrRootFolderRaw[]): ArrServiceOptions["rootFolders"] {
  return items.flatMap((item) => {
    const path = item.path?.trim();
    if (!path || (item.freeSpace !== undefined && !Number.isFinite(item.freeSpace))) {
      return [];
    }

    return [
      {
        path,
        freeSpace: item.freeSpace,
      },
    ];
  });
}

async function arrFetch<T>(
  service: "Radarr" | "Sonarr",
  baseUrl: string,
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("X-Api-Key", apiKey);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetchWithTimeout(service, `${baseUrl}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new HttpError(response.status, `${service} returned ${response.status}.`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
