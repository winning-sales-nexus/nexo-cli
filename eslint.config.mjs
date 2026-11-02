import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import local from './eslint-rules/index.mjs';

export default tseslint.config(
    {
        ignores: ['dist/**', 'node_modules/**', 'src/generated/**', 'eslint.config.mjs', 'eslint-rules/**', 'vitest.config.mts']
    },
    eslint.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        plugins: { local },
        rules: {
            eqeqeq: ['error', 'always'],
            'no-console': 'error',
            'local/no-comments': 'error',
            'local/no-else': 'error',
            'local/no-search-in-loop': 'error',
            'local/no-nested-loops': 'error',
            'local/max-logic-lines': ['error', { max: 30 }],
            'no-lonely-if': 'error',
            complexity: ['error', 10],
            'max-depth': ['error', 2],
            'max-params': ['error', 8],
            'max-lines-per-function': ['error', { max: 40, skipBlankLines: true }],
            '@typescript-eslint/no-extraneous-class': 'off',
            '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'explicit' }],
            '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
            '@typescript-eslint/explicit-module-boundary-types': 'error',
            '@typescript-eslint/typedef': [
                'error',
                {
                    variableDeclaration: true,
                    variableDeclarationIgnoreFunction: true,
                    memberVariableDeclaration: true,
                    propertyDeclaration: true,
                    parameter: true
                }
            ],
            '@typescript-eslint/prefer-readonly': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
            ],
            '@typescript-eslint/no-import-type-side-effects': 'error',
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'TSEnumDeclaration',
                    message: 'TS enums are forbidden — use `as const` objects or string unions (conventions skill).'
                },
                {
                    selector: 'ExportDefaultDeclaration',
                    message: 'Default exports are forbidden (conventions skill).'
                }
            ]
        }
    },
    {
        files: ['src/**/*.types.ts'],
        rules: { '@typescript-eslint/typedef': 'off' }
    },
    {
        files: ['src/**/*.spec.ts', 'test/**/*.ts'],
        rules: {
            'local/no-search-in-loop': 'off',
            'local/no-else': 'off',
            'max-lines-per-function': 'off',
            'local/max-logic-lines': 'off'
        }
    },
    prettier
);
