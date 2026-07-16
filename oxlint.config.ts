import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: ["oxlint-tailwindcss"],
  plugins: ["jsx-a11y"],
  settings: {
    tailwindcss: {
      entryPoint: "src/client/styles.css",
    },
  },
  rules: {
    "tailwindcss/no-unknown-classes": "error",
    "tailwindcss/no-conflicting-classes": "error",
    "tailwindcss/no-duplicate-classes": "warn",
    "tailwindcss/enforce-sort-order": "warn",
    "tailwindcss/enforce-canonical": "warn",
  },
});
