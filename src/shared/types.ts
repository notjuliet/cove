export type MediaType = "movie" | "tv";

export type RequestAvailability = "requested" | "available";

export type SearchKind = MediaType | "multi";

export interface MediaSnapshot {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath?: string;
  backdropPath?: string;
  releaseDate?: string;
}

export interface TmdbMedia extends MediaSnapshot {
  overview?: string;
  seasons?: TmdbSeason[];
  availability?: RequestAvailability;
  availableSeasonNumbers?: number[];
}

export interface TmdbSeason {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airDate?: string;
  posterPath?: string;
  overview?: string;
}

export interface CreateMediaRequest extends MediaSnapshot {
  requestedByUserId: number;
  seasonNumbers?: number[];
}

export interface MediaRequest extends MediaSnapshot {
  id: number;
  requestedByUserId: number;
  requestedBy: string;
  availability: RequestAvailability;
  seasonNumbers?: number[];
  availableSeasonNumbers?: number[];
  createdAt: string;
}

export interface MediaRequestPage {
  requests: MediaRequest[];
  total: number;
}

export interface AuthUser {
  id: number;
  jellyfinUserId: string;
  name: string;
  isAdministrator: boolean;
}

export interface AdminUser extends AuthUser {
  requestCount: number;
}

export interface HealthResponse {
  ok: boolean;
  setupRequired: boolean;
}

export interface AppSettingsSummary {
  setupRequired: boolean;
  integrations: {
    tmdb: boolean;
    radarr: boolean;
    radarrReady: boolean;
    sonarr: boolean;
    sonarrReady: boolean;
    jellyfin: boolean;
  };
}

export interface AdminIntegrationSettings {
  app: {
    publicOrigin?: string;
  };
  tmdb: {
    tokenConfigured: boolean;
  };
  jellyfin: {
    url?: string;
    apiKeyConfigured: boolean;
  };
  radarr: {
    url?: string;
    apiKeyConfigured: boolean;
    rootFolderPath?: string;
    qualityProfileId?: number;
  };
  sonarr: {
    url?: string;
    apiKeyConfigured: boolean;
    rootFolderPath?: string;
    animeRootFolderPath?: string;
    qualityProfileId?: number;
  };
}

export interface ArrQualityProfileOption {
  id: number;
  name: string;
}

export interface ArrRootFolderOption {
  path: string;
  freeSpace?: number;
}

export interface ArrServiceOptions {
  qualityProfiles: ArrQualityProfileOption[];
  rootFolders: ArrRootFolderOption[];
}
