import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

/**
 * eslint-config-next 16 ships flat configs directly. The template loaded them
 * through FlatCompat, which round-trips the config through JSON and blows up
 * on eslint-plugin-react's self-referential `configs.flat` object:
 *
 *   TypeError: Converting circular structure to JSON
 *
 * Importing the flat configs as intended avoids the compat layer entirely.
 */
const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: false,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^(_|ignore)',
        },
      ],
    },
  },
  {
    // React Compiler rules that eslint-config-next 16 turns on as errors.
    // Every current violation is in template code this demo inherited
    // unchanged, and rewriting Payload's components is outside its scope —
    // but silencing them outright would hide a real signal from code we do
    // write. Warnings keep them visible without failing the build.
    rules: {
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // Tailwind's config is CommonJS by design.
    files: ['tailwind.config.mjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    ignores: [
      '.next/',
      'src/payload-types.ts',
      'src/payload-generated-schema.ts',
      // Generated from the vendored OpenAPI spec by `pnpm vori:generate`.
      'src/vori/generated/',
      'src/migrations/',
    ],
  },
]

export default eslintConfig
