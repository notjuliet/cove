import { HttpError } from "./errors";

export function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeUrl(value: unknown): string | undefined {
  const text = optionalText(value);
  if (!text) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new HttpError(400, "Integration URLs must be valid URLs.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "Integration URLs must start with http:// or https://.");
  }

  return url.href.replace(/\/+$/, "");
}

export function normalizeOrigin(value: unknown): string | undefined {
  const text = optionalText(value);
  if (!text) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new HttpError(400, "Public URL must be a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "Public URL must start with http:// or https://.");
  }

  return url.origin;
}

export function requiredUrl(value: unknown, label: string): string {
  const url = normalizeUrl(value);
  if (!url) {
    throw new HttpError(400, `${label} is required.`);
  }

  return url;
}

export function requiredOrigin(value: unknown, label: string): string {
  const origin = normalizeOrigin(value);
  if (!origin) {
    throw new HttpError(400, `${label} is required.`);
  }

  return origin;
}

export function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${label} must be a positive integer.`);
  }

  return parsed;
}

export function optionalBearerToken(value: unknown): string | undefined {
  return optionalText(value)?.replace(/^Bearer\s+/i, "");
}

export function withConnectionInput<T extends { url?: string; apiKey?: string }>(
  settings: T,
  input: { url?: string; apiKey?: string },
): T {
  return {
    ...settings,
    url: input.url ?? settings.url,
    apiKey: input.apiKey ?? settings.apiKey,
  };
}
