import { randomBytes, timingSafeEqual } from "node:crypto";

import { config } from "./config";
import { hasCompletedSetup } from "./db";
import { logger } from "./logger";

const maxSetupTokenChars = 256;
let generatedSetupToken: string | undefined;

export function logFirstRunSetupToken(): void {
  if (hasCompletedSetup()) {
    return;
  }

  const token = setupToken();
  logger.info("Cove first-run setup is waiting for an admin Jellyfin account.");
  logger.info(`Setup token: ${token}`);
  logger.info(`Setup URL: ${firstRunSetupUrl(token)}`);
  logger.info("Open this URL to configure Cove.");
}

export function verifySetupToken(value: unknown): boolean {
  if (hasCompletedSetup() || typeof value !== "string") {
    return false;
  }

  return timingSafeStringEqual(value.trim(), setupToken());
}

function setupToken(): string {
  return (generatedSetupToken ??= `cove-setup-${randomBytes(18).toString("base64url")}`);
}

function firstRunSetupUrl(token: string): string {
  const url = new URL("/setup", `http://localhost:${config.port}`);
  url.hash = new URLSearchParams({ setupToken: token }).toString();
  return url.href;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.alloc(maxSetupTokenChars * 4);
  const rightBytes = Buffer.alloc(maxSetupTokenChars * 4);
  const leftLength = leftBytes.write(left.slice(0, maxSetupTokenChars), "utf8");
  const rightLength = rightBytes.write(right.slice(0, maxSetupTokenChars), "utf8");
  const tooLong = left.length > maxSetupTokenChars || right.length > maxSetupTokenChars;

  return timingSafeEqual(leftBytes, rightBytes) && leftLength === rightLength && !tooLong;
}
