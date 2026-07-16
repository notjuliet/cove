import { logger } from "./logger";
import { applySecurityHeaders } from "./security-headers";

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function errorToResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonError(error.status, error.message);
  }

  logger.error(error);
  return jsonError(500, "Something went wrong.");
}

function jsonError(status: number, error: string): Response {
  const headers = applySecurityHeaders(new Headers());
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify({ error }, null, 2), {
    status,
    headers,
  });
}
