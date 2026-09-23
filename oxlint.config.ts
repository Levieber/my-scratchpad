import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "node", "eslint", "unicorn", "oxc", "react", "jsx-a11y"],
  categories: {
    correctness: "error",
  },
  rules: {
    // Deprecated APIs are often no-ops rather than errors, so nothing else would catch them.
    // Type-aware, hence `typeAware` below.
    "typescript/no-deprecated": "error",
  },
  options: {
    typeAware: true,
    maxWarnings: 5,
  },
  env: { builtin: true, es2024: true, browser: true, node: true },
});
