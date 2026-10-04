import { defineConfig } from "oxlint";

export default defineConfig({
  // Vendored upstream source (read-only reference), linted by its own project.
  ignorePatterns: ["repos/**"],
  plugins: ["typescript", "node", "eslint", "unicorn", "oxc", "react", "jsx-a11y"],
  categories: {
    correctness: "error",
  },
  rules: {
    // Deprecated APIs are often no-ops rather than errors, so nothing else would catch them.
    // Type-aware, hence `typeAware` below.
    "typescript/no-deprecated": "error",
  },
  overrides: [
    {
      // A PWA file over ~200 lines of code is doing two things: split it (issue #3). Comments
      // don't count, so explaining a decision never pushes a file over.
      files: ["src/web/**/*.{ts,tsx}"],
      rules: {
        "eslint/max-lines": ["error", { max: 200, skipBlankLines: true, skipComments: true }],
        // A hook called conditionally works until the condition flips; nothing else catches it.
        "react/rules-of-hooks": "error",
      },
    },
    {
      // shadcn's components, copied whole from its registry (see knip.ts).
      files: ["src/web/components/ui/**"],
      rules: { "eslint/max-lines": "off" },
    },
  ],
  options: {
    typeAware: true,
    maxWarnings: 5,
  },
  env: { builtin: true, es2024: true, browser: true, node: true },
});
