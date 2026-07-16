import type { AppSettingsSummary, ArrServiceOptions, AuthUser } from "../../shared/types";

export type AdminSettingsInput = {
  publicOrigin: string;
  jellyfinUrl: string;
  jellyfinApiKey?: string;
  tmdbToken?: string;
  radarrUrl?: string;
  radarrApiKey?: string;
  radarrRootFolderPath?: string;
  radarrQualityProfileId?: string;
  sonarrUrl?: string;
  sonarrApiKey?: string;
  sonarrRootFolderPath?: string;
  sonarrAnimeRootFolderPath?: string;
  sonarrQualityProfileId?: string;
};

export type ArrServiceName = "radarr" | "sonarr";

export type ConnectionInput = {
  url?: string;
  apiKey?: string;
};

export type ArrOptionsState = Partial<Record<ArrServiceName, ArrServiceOptions>>;

export type ArrOptionsBusyState = Partial<Record<ArrServiceName, boolean>>;

export type ArrOptionsErrorState = Partial<Record<ArrServiceName, boolean>>;

export type FirstRunSetupInput = {
  setupToken: string;
  publicOrigin: string;
  jellyfinUrl: string;
  jellyfinApiKey?: string;
  username: string;
  password: string;
  tmdbToken: string;
};

export type SetupResponse = {
  user: AuthUser;
  settings: AppSettingsSummary;
};

export type AdminTab = "users" | "settings";

export type NoticeTone = "neutral" | "error";

export type AppRoute =
  | { page: "home" }
  | { page: "search"; query: string }
  | { page: "requests" }
  | { page: "admin"; tab: AdminTab };
