import { afterAll, afterEach, beforeAll, expect } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = mkdtempSync(join(tmpdir(), "cove-tests-"));
const nativeFetch = globalThis.fetch;

Bun.env.DATA_DIR = testDir;

export let db: typeof import("../src/server/db");
export let arr: typeof import("../src/server/services/arr");
export let apiServer: typeof import("../src/server/index");
export let cookies: typeof import("../src/server/cookies");
export let http: typeof import("../src/server/http");
export let jobs: typeof import("../src/server/jobs");
export let jellyfin: typeof import("../src/server/services/jellyfin");
export let requestSecurity: typeof import("../src/server/request-security");
export let staticServer: typeof import("../src/server/static");

beforeAll(async () => {
  db = await import("../src/server/db");
  db.saveIntegrationSettings({
    jellyfinUrl: "http://jellyfin.test",
    tmdbToken: "tmdb-token",
  });
  arr = await import("../src/server/services/arr");
  apiServer = await import("../src/server/index");
  cookies = await import("../src/server/cookies");
  http = await import("../src/server/http");
  jobs = await import("../src/server/jobs");
  jellyfin = await import("../src/server/services/jellyfin");
  requestSecurity = await import("../src/server/request-security");
  staticServer = await import("../src/server/static");
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

export function expectPrivateTestDatabase(): void {
  expect(statSync(testDir).mode & 0o777).toBe(0o700);
  expect(statSync(join(testDir, "cove.sqlite")).mode & 0o777).toBe(0o600);
}

export function createRouteTestSessions(label: string) {
  db.completeSetup();

  const user = db.upsertJellyfinUser({
    jellyfinUserId: `jf-${label}-user`,
    name: `${label}-user`,
    isAdministrator: false,
  });
  const admin = db.upsertJellyfinUser({
    jellyfinUserId: `jf-${label}-admin`,
    name: `${label}-admin`,
    isAdministrator: true,
  });

  return {
    user,
    admin,
    userSession: db.createAuthSession(user),
    adminSession: db.createAuthSession(admin),
  };
}

export function requestOwner(name: string): { requestedByUserId: number } {
  const user = db.upsertJellyfinUser({
    jellyfinUserId: `jf-request-${name}`,
    name,
    isAdministrator: false,
  });

  return {
    requestedByUserId: user.id,
  };
}

export function expectSecurityHeaders(response: Response): void {
  const csp = response.headers.get("Content-Security-Policy") ?? "";

  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("img-src 'self' https://image.tmdb.org data:");
  expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
}

export function apiRequest(
  path: string,
  token?: string,
  method = "GET",
  body?: unknown,
  extraHeaders: HeadersInit = {},
): Promise<Response> {
  const url = new URL(path, "http://127.0.0.1");
  const headers = new Headers(extraHeaders);
  if (token) {
    headers.set("Cookie", `${cookies.sessionCookieName}=${encodeURIComponent(token)}`);
  }
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  return apiServer.handleApi(new Request(url, init), url);
}

export function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
