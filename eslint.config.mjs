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
  '@typescript-eslint/no-require-imports': 'error',
  'no-console': 'off',
};

// Data-path resolvers from @portel/photon-core take an optional trailing
// baseDir and fall back to PHOTON_DIR/~/.photon when it is omitted. Ambient
// fallback at call time is how the memory/storage baseDir drift bugs
// happened. Every call must pass baseDir explicitly (use
// getDefaultContext().baseDir when the boot context is the right answer).
// Legacy* variants are migration fallbacks and exempt.
// Photon identity strings (photon:instance ids, channels, circuit keys)
// have exactly one owner: src/shared/identity.ts. Hand-rolled split(':')
// picks the wrong end sooner or later ("ps disable photon:hash:method" was
// a silent no-op for months). Non-identity colon parsing (PATH, host:port,
// format specs) gets a per-line eslint-disable WITH a reason.
const explicitBaseDirRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "CallExpression[callee.property.name='split'][arguments.0.value=':']",
      message:
        "Use the helpers in src/shared/identity.ts for photon identity strings (parsePsTarget, parseChannel, ...). If this is genuinely not an identity (PATH, host:port, format spec), add an eslint-disable with the reason.",
    },
    {
      selector: "CallExpression[callee.property.name='lastIndexOf'][arguments.0.value=':']",
      message:
        'Use parsePsTarget/parseChannel from src/shared/identity.ts instead of hand-rolled colon arithmetic.',
    },
    {
      selector:
        'CallExpression[callee.name=/^(getDataRoot|getGlobalMemoryDir|getCacheDir|getTasksDir|getAuditPath|getMetadataPath)$/][arguments.length=0]',
      message:
        'Pass an explicit baseDir (e.g. getDefaultContext().baseDir) — ambient PHOTON_DIR/~/.photon fallback causes data-path drift.',
    },
    {
      selector:
        'CallExpression[callee.name=/^(getPhotonDataDir|getPhotonMemoryDir|getPhotonEnvPath|getPhotonContextPath|getPhotonRunsDir|getPhotonLogsDir|getPhotonSchedulesDir|getPhotonConfigPath)$/][arguments.length<3]',
      message:
        'Pass an explicit baseDir as the third argument — ambient PHOTON_DIR/~/.photon fallback causes data-path drift.',
    },
    {
      selector:
        'CallExpression[callee.name=/^(getPhotonStatePath|getPhotonStateLogPath|getSessionMemoryDir)$/][arguments.length<4]',
      message:
        'Pass an explicit baseDir as the fourth argument — ambient PHOTON_DIR/~/.photon fallback causes data-path drift.',
    },
  ],
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
      ...explicitBaseDirRules,
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
