type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, values: unknown[]): void {
  const prefix = `[${timestamp()}] ${level}`;

  if (level === "error") {
    console.error(prefix, ...values);
    return;
  }

  if (level === "warn") {
    console.warn(prefix, ...values);
    return;
  }

  console.log(prefix, ...values);
}

function timestamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export const logger = {
  info(...values: unknown[]) {
    write("info", values);
  },
  warn(...values: unknown[]) {
    write("warn", values);
  },
  error(...values: unknown[]) {
    write("error", values);
  },
};
