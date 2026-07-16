import type { TmdbMedia } from "../../shared/types";

const imageBaseUrl = "https://image.tmdb.org/t/p";

export function posterUrl(path?: string): string | undefined {
  return path ? `${imageBaseUrl}/w342${path}` : undefined;
}

export function userAvatarUrl(userId: number): string {
  return `/api/users/${userId}/avatar`;
}

export function jellyfinMediaUrl(item: Pick<TmdbMedia, "mediaType" | "tmdbId">): string {
  return `/api/media/${item.mediaType}/${item.tmdbId}/jellyfin`;
}

export function arrMediaUrl(item: Pick<TmdbMedia, "mediaType" | "tmdbId">): string {
  return `/api/media/${item.mediaType}/${item.tmdbId}/arr`;
}

export function letterboxdTmdbUrl(item: Pick<TmdbMedia, "tmdbId">): string {
  return `https://letterboxd.com/tmdb/${item.tmdbId}/`;
}

export function mediaKey(item: TmdbMedia): string {
  return `${item.mediaType}:${item.tmdbId}`;
}

export function yearFor(value?: string): string {
  return value?.slice(0, 4) || "TBA";
}

export function seasonLabel(seasonNumber: number, name?: string): string {
  if (seasonNumber === 0) {
    return name && name !== "Specials" ? `Specials · ${name}` : "Specials";
  }

  return name && name !== `Season ${seasonNumber}`
    ? `Season ${seasonNumber} · ${name}`
    : `Season ${seasonNumber}`;
}

export function seasonListLabel(seasonNumbers: number[]): string {
  const labels = seasonNumbers
    .slice()
    .sort((a, b) => a - b)
    .map((seasonNumber) => (seasonNumber === 0 ? "Specials" : `S${seasonNumber}`));
  return labels.length === 1 ? labels[0] : labels.join(", ");
}

export function formatBytes(value: number): string {
  if (value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** exponent;
  return `${amount.toFixed(amount >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
