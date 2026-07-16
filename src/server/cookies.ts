export const sessionCookieName = "cove_session";

const sessionMaxAgeSeconds = 30 * 24 * 60 * 60;

export function shouldUseSecureCookies(
  request: Request,
  url = new URL(request.url),
  publicOrigin?: string,
): boolean {
  if (publicOrigin) {
    return new URL(publicOrigin).protocol === "https:";
  }

  const forwardedProto = request.headers
    .get("X-Forwarded-Proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();

  if (forwardedProto === "https") {
    return true;
  }

  if (forwardedProto === "http") {
    return false;
  }

  return url.protocol === "https:";
}

export function makeSessionCookie(token: string, secure: boolean): string {
  return [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${sessionMaxAgeSeconds}`,
    secure ? "Secure" : undefined,
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [
    `${sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : undefined,
  ]
    .filter(Boolean)
    .join("; ");
}
