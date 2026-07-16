import { HttpError } from "./errors";

export const outboundRequestTimeoutMs = 10_000;

export async function fetchWithTimeout(
  service: string,
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  timeoutMs = outboundRequestTimeoutMs,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch {
    if (timedOut) {
      throw new HttpError(504, `${service} request timed out.`);
    }

    throw new HttpError(502, `${service} request failed.`);
  } finally {
    clearTimeout(timeout);
  }
}
