import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "packages/db/generated/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      /**
       * Floating-point parsing is banned in a financial codebase. Amounts enter the
       * system through Money.parse() and stay bigint fils from there.
       * @see packages/core/src/money/money.ts
       */
      "no-restricted-globals": [
        "error",
        { name: "parseFloat", message: "Use Money.parse() — no floats in the financial path." },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Number",
          property: "parseFloat",
          message: "Use Money.parse() — no floats in the financial path.",
        },
      ],
    },
  },
  {
    // Tests may reach for shortcuts the production code may not.
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
