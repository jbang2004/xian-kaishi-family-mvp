import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    ".vinext/**",
    ".wrangler/**",
    ".venv/**",
    "coverage/**",
    "dist/**",
    "out/**",
    "outputs/**",
    "tmp/**",
    "work/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
