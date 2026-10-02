import { defineConfig } from "oxfmt";

export default defineConfig({
  sortImports: true,
  // Vendored upstream source (read-only reference), formatted by its own project.
  ignorePatterns: ["repos/**"],
});
