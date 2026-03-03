import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const typeCheckedRules = tseslint.configs['recommended-type-checked'].rules;
const recommendedRules = tseslint.configs['recommended'].rules;

const commonOverrides = {
  // Allow `any` types — this is a dynamic runtime that bridges untyped external systems
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-unsafe-assignment': 'off',
  '@typescript-eslint/no-unsafe-member-access': 'off',
  '@typescript-eslint/no-unsafe-argument': 'off',
  '@typescript-eslint/no-unsafe-call': 'off',
  '@typescript-eslint/no-unsafe-return': 'off',
  // `async` on interface/handler methods without await is intentional for API consistency
  '@typescript-eslint/require-await': 'off',
  '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  '@typescript-eslint/no-require-imports': 'off',
  'no-console': 'off',
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.js', '**/*.mjs'],
  },
  // Type-aware rules for src/ (covered by root tsconfig.json, excluding frontend)
  {
    files: ['src/**/*.ts'],
    ignores: ['src/auto-ui/frontend/**'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: true,
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...typeCheckedRules,
      ...commonOverrides,
    },
  },
  // Type-aware rules for frontend/ (covered by frontend tsconfig.json)
  {
    files: ['src/auto-ui/frontend/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: true,
        tsconfigRootDir: `${__dirname}/src/auto-ui/frontend`,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...typeCheckedRules,
      ...commonOverrides,
    },
  },
  // Basic rules for tests/ (not in main tsconfig)
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...recommendedRules,
      ...commonOverrides,
    },
  },
  // Disable rules that conflict with Prettier formatting
  prettierConfig,
];
