import { join } from "node:path";

function optionalNumber(name: string): number | undefined {
  const value = Bun.env[name];
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const dataDir = optionalText(Bun.env.DATA_DIR) ?? join(process.cwd(), "data");

export const config = {
  host: optionalText(Bun.env.HOST) ?? "0.0.0.0",
  port: optionalNumber("PORT") ?? 3000,
  databasePath: join(dataDir, "cove.sqlite"),
};
