import type { MediaType, SearchKind, TmdbMedia, TmdbSeason } from "../../shared/types";
import { getIntegrationSettings } from "../db";
import { HttpError } from "../errors";
import { fetchWithTimeout } from "../http";

const tmdbBaseUrl = "https://api.themoviedb.org/3";

type TmdbMediaRaw = {
  id?: number;
  media_type?: string;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  original_language?: string;
  origin_country?: string[];
  genres?: TmdbGenreRaw[];
  seasons?: TmdbSeasonRaw[];
  external_ids?: TmdbTvExternalIds;
  keywords?: TmdbKeywordsRaw;
};

export type TmdbTvExternalIds = {
  id: number;
  imdb_id?: string | null;
  tvdb_id?: number | null;
};

type TmdbGenreRaw = {
  id?: number;
  name?: string;
};

type TmdbKeywordRaw = {
  id?: number;
  name?: string;
};

type TmdbKeywordsRaw = {
  keywords?: TmdbKeywordRaw[];
  results?: TmdbKeywordRaw[];
};

type TmdbSeasonRaw = {
  season_number?: number;
  name?: string;
  episode_count?: number;
  air_date?: string | null;
  poster_path?: string | null;
  overview?: string;
};

export type TmdbTvDetails = TmdbMedia & {
  mediaType: "tv";
  externalIds: TmdbTvExternalIds;
  originalLanguage?: string;
  originCountry: string[];
  genres: string[];
  keywords: string[];
};

export async function searchTmdb(query: string, kind: SearchKind): Promise<TmdbMedia[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const path = kind === "movie" ? "/search/movie" : kind === "tv" ? "/search/tv" : "/search/multi";
  const data = await tmdbGet<{ results?: TmdbMediaRaw[] }>(path, {
    query: trimmed,
    include_adult: "false",
  });

  return (data.results ?? [])
    .map((item) => mapTmdbMedia(item, kind === "multi" ? undefined : kind))
    .filter((item): item is TmdbMedia => Boolean(item));
}

export async function getTmdbTvDetails(tmdbId: number): Promise<TmdbMedia> {
  const data = await tmdbGet<TmdbMediaRaw>(`/tv/${tmdbId}`);
  const mapped = mapTmdbMedia(data, "tv");
  if (!mapped) {
    throw new HttpError(404, "TMDB series not found.");
  }

  return mapped;
}

export async function getTvDetails(tmdbId: number): Promise<TmdbTvDetails> {
  const data = await tmdbGet<TmdbMediaRaw>(`/tv/${tmdbId}`, {
    append_to_response: "external_ids,keywords",
  });
  const mapped = mapTmdbMedia(data, "tv");
  if (!mapped) {
    throw new HttpError(404, "TMDB series not found.");
  }

  return {
    ...mapped,
    mediaType: "tv",
    externalIds: data.external_ids ?? { id: tmdbId },
    originalLanguage: data.original_language,
    originCountry: data.origin_country ?? [],
    genres: mapNames(data.genres),
    keywords: mapNames(data.keywords?.results ?? data.keywords?.keywords),
  };
}

async function tmdbGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = getIntegrationSettings().tmdb.token;
  if (!token) {
    throw new HttpError(503, "TMDB is not configured.");
  }

  if (isLegacyApiKey(token)) {
    throw new HttpError(503, "The TMDB token must be the API Read Access Token, not the API Key.");
  }

  const url = new URL(`${tmdbBaseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  });

  const response = await fetchWithTimeout("TMDB", url, { headers });
  if (!response.ok) {
    const message =
      response.status === 401
        ? "TMDB rejected the token. Use the TMDB API Read Access Token, not the API Key."
        : `TMDB returned ${response.status}.`;
    throw new HttpError(response.status, message);
  }

  return response.json() as Promise<T>;
}

function isLegacyApiKey(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value);
}

function mapTmdbMedia(item: TmdbMediaRaw, forcedType?: MediaType): TmdbMedia | undefined {
  const mediaType = forcedType ?? item.media_type;
  if (mediaType !== "movie" && mediaType !== "tv") {
    return undefined;
  }

  if (!item.id) {
    return undefined;
  }

  const title = mediaType === "movie" ? item.title : item.name;
  if (!title) {
    return undefined;
  }

  return {
    tmdbId: item.id,
    mediaType,
    title,
    overview: item.overview,
    posterPath: item.poster_path ?? undefined,
    backdropPath: item.backdrop_path ?? undefined,
    releaseDate: mediaType === "movie" ? item.release_date : item.first_air_date,
    seasons: mediaType === "tv" ? mapTmdbSeasons(item.seasons) : undefined,
  };
}

function mapTmdbSeasons(seasons: TmdbSeasonRaw[] | undefined): TmdbSeason[] | undefined {
  const mapped = (seasons ?? []).flatMap((season) => {
    const seasonNumber = season.season_number;
    const name = season.name?.trim();
    const episodeCount = season.episode_count;
    if (
      !Number.isInteger(seasonNumber) ||
      seasonNumber === undefined ||
      seasonNumber < 0 ||
      !name ||
      !Number.isInteger(episodeCount) ||
      episodeCount === undefined ||
      episodeCount < 0
    ) {
      return [];
    }

    return [
      {
        seasonNumber,
        name,
        episodeCount,
        airDate: season.air_date ?? undefined,
        posterPath: season.poster_path ?? undefined,
        overview: season.overview,
      },
    ];
  });

  return mapped.length > 0 ? mapped : undefined;
}

function mapNames(items: Array<{ name?: string }> | undefined): string[] {
  return (items ?? []).flatMap((item) => {
    const name = item.name?.trim();
    return name ? [name] : [];
  });
}
