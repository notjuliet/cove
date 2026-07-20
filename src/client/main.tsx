import { ErrorBoundary } from "solid-js";
import { render } from "solid-js/web";

import App from "./App";

import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found.");
}

render(
  () => (
    <ErrorBoundary
      fallback={(error) => (
        <main class="flex min-h-screen items-center justify-center p-6 text-(--color-text)">
          <section class="max-w-md rounded-lg border border-(--color-border) bg-(--color-surface) p-5">
            <h1 class="text-lg font-semibold">Cove hit a UI error.</h1>
            <p class="mt-2 text-sm text-(--color-muted)">
              Refresh the page and try again. If it keeps happening, check the browser console.
            </p>
            <pre class="mt-4 overflow-auto rounded bg-(--color-surface-soft) p-3 text-xs text-(--color-muted)">
              {error instanceof Error ? error.message : String(error)}
            </pre>
          </section>
        </main>
      )}
    >
      <App />
    </ErrorBoundary>
  ),
  root,
);
