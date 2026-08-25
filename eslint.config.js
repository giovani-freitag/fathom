import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },

    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,

    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: { '@stylistic': stylistic },
        rules: {
            '@stylistic/semi': ['error', 'always'],
            '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
            '@stylistic/indent': ['error', 4],
            '@stylistic/comma-dangle': ['error', 'always-multiline'],
            '@stylistic/eol-last': ['error', 'always'],

            // The renderer and the codec both index typed arrays in hot loops where a
            // bounds check has already been proven by the surrounding length guard.
            '@typescript-eslint/no-non-null-assertion': 'off',

            // Every listener in this codebase is a method bound once in its
            // constructor, which is what lets registration and removal use the
            // same reference. The rule cannot see that binding and flags the
            // pattern the architecture depends on.
            '@typescript-eslint/unbound-method': 'off',

            '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
            '@typescript-eslint/explicit-module-boundary-types': 'error',
            '@typescript-eslint/no-unnecessary-condition': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
        },
    },

    {
        files: ['src/app/**/*.{ts,tsx}'],
        extends: [reactHooks.configs.flat['recommended-latest']],
        plugins: { 'react-refresh': reactRefresh },
        rules: {
            'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
        },
    },

    {
        files: ['tests/**/*.ts', 'tests/**/*.tsx'],
        rules: {
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
        },
    },

    {
        files: ['*.config.{js,ts}', 'eslint.config.js'],
        languageOptions: { parserOptions: { projectService: false } },
        ...tseslint.configs.disableTypeChecked,
    },
);
