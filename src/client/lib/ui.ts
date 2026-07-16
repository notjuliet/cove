export const controlClass =
  "h-10 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-sm text-(--color-text) outline-none transition focus:ring-2 focus:ring-(--color-accent-soft)";

export const primaryButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-lg border border-transparent bg-(--color-button) px-4 text-sm font-semibold text-(--color-button-text) transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonBaseClass =
  "inline-flex items-center justify-center rounded-lg border border-(--color-border) bg-(--color-surface) font-semibold text-(--color-text) transition hover:bg-(--color-surface-hover) disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryButtonClass = `${secondaryButtonBaseClass} min-h-10 px-4 text-sm`;

export const smallSecondaryButtonClass = `${secondaryButtonBaseClass} min-h-8 px-2.5 text-xs`;

export const panelClass = "rounded-lg border border-(--color-border) bg-(--color-surface)";
