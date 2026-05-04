const path = require('node:path')

const base = require('@vinikjkkj/eslint-config')
const tsPlugin = require('@typescript-eslint/eslint-plugin')
const pluginImport = require('eslint-plugin-import')
const pluginN = require('eslint-plugin-n')

const TSCONFIG = path.resolve(__dirname, 'tsconfig.json')

module.exports = [
    {
        ignores: [
            'dist/**',
            'coverage/**',
            'node_modules/**',
            'examples/**',
            '/zapo/**',
            '/baileys/**',
            '/whatsmeow/**',
            '/wa-web/**'
        ]
    },
    ...base,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parserOptions: {
                tsconfigRootDir: __dirname,
                project: [TSCONFIG]
            }
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
            import: pluginImport,
            n: pluginN
        },
        settings: {
            'import/parsers': {
                '@typescript-eslint/parser': ['.ts', '.tsx']
            },
            // Classify our @-aliases as `internal` so import/order separates them
            // from `external` (zapo-js, etc.). Without this fallback, IDEs that
            // don't fully wire the typescript resolver group them together.
            'import/internal-regex': '^@(adapter|migrate|ir|codec|adapters)(/|$)',
            'import/resolver': {
                node: {
                    extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs']
                },
                typescript: {
                    alwaysTryTypes: true,
                    noWarnOnMultipleProjects: true,
                    // Absolute path so the resolver works regardless of the
                    // cwd ESLint is launched from (CLI vs VSCode/IDE plugin).
                    project: [TSCONFIG]
                }
            }
        },
        rules: {
            '@typescript-eslint/consistent-type-imports': [
                'error',
                {
                    prefer: 'type-imports',
                    fixStyle: 'inline-type-imports'
                }
            ],
            'import/no-duplicates': ['error', { 'prefer-inline': true }],
            'sort-imports': [
                'error',
                {
                    ignoreDeclarationSort: true,
                    ignoreCase: true,
                    ignoreMemberSort: false,
                    memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single']
                }
            ],
            'n/prefer-node-protocol': 'error',
            'n/no-extraneous-import': 'error',
            'import/no-unresolved': 'error'
        }
    },
    {
        // Forbid cross-module relative imports — use the @alias path instead.
        // Within a single module (e.g. inside src/adapters/baileys/) sibling
        // and child relatives (`./xyz`) are still fine.
        files: ['src/**/*.ts'],
        ignores: ['src/__tests__/**'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['..', '../*', '../**'],
                            message:
                                'cross-module relative imports are forbidden — use a path alias (@module/*) instead'
                        }
                    ]
                }
            ]
        }
    }
]
