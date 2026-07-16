import {
  getBackgroundJobTimestamp,
  getIntegrationSettings,
  hasCompletedSetup,
  reconcileJellyfinUsers,
  setBackgroundJobTimestamp,
} from "./db";
import { logger } from "./logger";
import {
  getJellyfinUsers,
  syncJellyfinAvailability,
  syncRecentlyAddedJellyfinAvailability,
} from "./services/jellyfin";

export const jellyfinRecentAvailabilitySyncInitialDelayMs = 30 * 1000;
export const jellyfinRecentAvailabilitySyncIntervalMs = 5 * 60 * 1000;
export const jellyfinFullAvailabilitySyncInitialDelayMs = 60 * 1000;
export const jellyfinFullAvailabilitySyncIntervalMs = 24 * 60 * 60 * 1000;
export const jellyfinUserSyncInitialDelayMs = 90 * 1000;
export const jellyfinUserSyncIntervalMs = 24 * 60 * 60 * 1000;

type JellyfinJobSkipResult = {
  skipped: true;
  reason: "setup-incomplete" | "jellyfin-not-configured" | "not-due" | "already-running";
};

export type JellyfinAvailabilitySyncJobResult =
  | JellyfinJobSkipResult
  | {
      skipped: false;
      availableCount: number;
      mode: "full" | "recent";
    };

export type JellyfinUserSyncJobResult =
  | JellyfinJobSkipResult
  | {
      skipped: false;
      syncedCount: number;
      removedCount: number;
    };

let jellyfinSyncRunning = false;
let jellyfinUserSyncRunning = false;

export function startBackgroundJobs(): { stop: () => void } {
  const recentJob = startRecurringJob(
    "Jellyfin recent availability scan",
    jellyfinRecentAvailabilitySyncInitialDelayMs,
    jellyfinRecentAvailabilitySyncIntervalMs,
    runJellyfinRecentAvailabilitySyncJob,
    (result) => (result.skipped ? "" : `found ${result.availableCount} titles`),
  );
  const fullJob = startRecurringJob(
    "Jellyfin full availability scan",
    jellyfinFullAvailabilitySyncInitialDelayMs,
    jellyfinFullAvailabilitySyncIntervalMs,
    runJellyfinFullAvailabilitySyncJob,
    (result) => (result.skipped ? "" : `found ${result.availableCount} titles`),
  );
  const userJob = startRecurringJob(
    "Jellyfin user sync",
    jellyfinUserSyncInitialDelayMs,
    jellyfinUserSyncIntervalMs,
    runJellyfinUserSyncJob,
    (result) =>
      result.skipped ? "" : `synced ${result.syncedCount} users and removed ${result.removedCount}`,
  );

  return {
    stop() {
      recentJob.stop();
      fullJob.stop();
      userJob.stop();
    },
  };
}

export function triggerJellyfinFullAvailabilitySync(reason: string): void {
  void runJellyfinFullAvailabilitySyncJob({ force: true }).catch((error) => {
    logger.warn(
      `Jellyfin full availability scan after ${reason} failed: ${
        error instanceof Error ? error.message : "Unknown error."
      }`,
    );
  });
}

export async function runJellyfinRecentAvailabilitySyncJob(): Promise<JellyfinAvailabilitySyncJobResult> {
  return runJellyfinSyncExclusive(async () => {
    const skipped = skipReason();
    if (skipped) {
      return skipped;
    }

    const previousSync = getBackgroundJobTimestamp("jobs.jellyfinRecentSync.completedAt");
    if (!previousSync) {
      return runJellyfinFullAvailabilitySyncJob({ force: true, skipLock: true });
    }

    const startedAt = new Date().toISOString();
    const result = await syncRecentlyAddedJellyfinAvailability(previousSync);
    setBackgroundJobTimestamp("jobs.jellyfinRecentSync.completedAt", startedAt);

    return {
      skipped: false,
      mode: "recent",
      availableCount: result.availableCount,
    };
  });
}

export async function runJellyfinFullAvailabilitySyncJob(
  options: { force?: boolean; skipLock?: boolean } = {},
): Promise<JellyfinAvailabilitySyncJobResult> {
  if (!options.skipLock) {
    return runJellyfinSyncExclusive(() =>
      runJellyfinFullAvailabilitySyncJob({ ...options, skipLock: true }),
    );
  }

  const skipped = skipReason();
  if (skipped) {
    return skipped;
  }

  if (!options.force && !isFullSyncDue()) {
    return { skipped: true, reason: "not-due" };
  }

  const startedAt = new Date().toISOString();
  const result = await syncJellyfinAvailability();
  setBackgroundJobTimestamp("jobs.jellyfinFullSync.completedAt", startedAt);
  setBackgroundJobTimestamp("jobs.jellyfinRecentSync.completedAt", startedAt);

  return {
    skipped: false,
    mode: "full",
    availableCount: result.availableCount,
  };
}

export async function runJellyfinUserSyncJob(
  options: { force?: boolean } = {},
): Promise<JellyfinUserSyncJobResult> {
  if (jellyfinUserSyncRunning) {
    return { skipped: true, reason: "already-running" };
  }

  jellyfinUserSyncRunning = true;
  try {
    const skipped = skipReason();
    if (skipped) {
      return skipped;
    }

    if (
      !options.force &&
      !isJobDue("jobs.jellyfinUserSync.completedAt", jellyfinUserSyncIntervalMs)
    ) {
      return { skipped: true, reason: "not-due" };
    }

    const users = await getJellyfinUsers();
    const result = reconcileJellyfinUsers(users);
    setBackgroundJobTimestamp("jobs.jellyfinUserSync.completedAt", new Date().toISOString());

    return {
      skipped: false,
      ...result,
    };
  } finally {
    jellyfinUserSyncRunning = false;
  }
}

async function runJellyfinSyncExclusive(
  run: () => Promise<JellyfinAvailabilitySyncJobResult>,
): Promise<JellyfinAvailabilitySyncJobResult> {
  if (jellyfinSyncRunning) {
    return { skipped: true, reason: "already-running" };
  }

  jellyfinSyncRunning = true;
  try {
    return await run();
  } finally {
    jellyfinSyncRunning = false;
  }
}

function startRecurringJob<Result extends { skipped: boolean }>(
  label: string,
  initialDelayMs: number,
  intervalMs: number,
  run: () => Promise<Result>,
  successMessage: (result: Result) => string,
): { stop: () => void } {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function tick(): Promise<void> {
    if (stopped || running) {
      return;
    }

    running = true;
    try {
      const result = await run();
      if (!result.skipped) {
        logger.info(`${label} ${successMessage(result)}.`);
      }
    } catch (error) {
      logger.warn(`${label} failed: ${error instanceof Error ? error.message : "Unknown error."}`);
    } finally {
      running = false;
    }
  }

  async function tickAndSchedule(): Promise<void> {
    await tick();
    if (!stopped) {
      timer = setTimeout(() => void tickAndSchedule(), intervalMs);
    }
  }

  timer = setTimeout(() => void tickAndSchedule(), initialDelayMs);

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    },
  };
}

function skipReason(): JellyfinJobSkipResult | undefined {
  if (!hasCompletedSetup()) {
    return { skipped: true, reason: "setup-incomplete" };
  }

  const settings = getIntegrationSettings().jellyfin;
  if (!settings.url || !settings.apiKey) {
    return { skipped: true, reason: "jellyfin-not-configured" };
  }

  return undefined;
}

function isFullSyncDue(): boolean {
  return isJobDue("jobs.jellyfinFullSync.completedAt", jellyfinFullAvailabilitySyncIntervalMs);
}

function isJobDue(
  key: Parameters<typeof getBackgroundJobTimestamp>[0],
  intervalMs: number,
): boolean {
  const completedAt = getBackgroundJobTimestamp(key);
  if (!completedAt) {
    return true;
  }

  const completedAtTime = new Date(completedAt).getTime();
  if (!Number.isFinite(completedAtTime)) {
    return true;
  }

  return Date.now() - completedAtTime >= intervalMs;
}
