import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const pureSourceFiles = [
  "src/build-status.ts",
  "src/domain/**/*.ts",
  "src/engine/**/*.ts",
  "src/ghosts/**/*.ts",
  "src/levels/**/*.ts",
  "src/history/domain/**/*.ts",
];

export default tseslint.config(
  {
    ignores: [
      ".dev/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((configuration) => ({
    ...configuration,
    files: ["**/*.ts"],
  })),
  ...tseslint.configs.stylisticTypeChecked.map((configuration) => ({
    ...configuration,
    files: ["**/*.ts"],
  })),
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "*.config.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
      "@typescript-eslint/no-confusing-void-expression": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: pureSourceFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
  },
  {
    files: pureSourceFiles,
    languageOptions: {
      globals: globals.es2022,
    },
  },
  {
    files: [
      "tests/unit/**/*.ts",
      "tests/property/**/*.ts",
      "tests/integration/**/*.ts",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
  },
  {
    files: ["tests/e2e/**/*.ts", "*.config.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
