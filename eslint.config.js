import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist/**',
    'android/app/build/**',
    'android/app/src/main/assets/**',
    'ios/App/App/public/**',
    'ios/build/**',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Native data is intentionally loaded into component state from effects.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
  {
    files: ['version-manager.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/hooks/useBiometric.js'],
    rules: {
      // Legacy optional hook; its native package is loaded only when present.
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
])
