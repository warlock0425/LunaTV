const js = require('@eslint/js');
const prettier = require('eslint-config-prettier');
const simpleImportSort = require('eslint-plugin-simple-import-sort');
const unusedImports = require('eslint-plugin-unused-imports');
const globals = require('globals');

const nextCoreWebVitals = require('eslint-config-next/core-web-vitals');
const nextTypescript = require('eslint-config-next/typescript');

module.exports = [
  // 原 .eslintignore 內容
  {
    ignores: [
      'public/sw.js',
      'public/workbox-*.js',
      '.next/',
      'node_modules/',
      'dist/',
      'build/',
    ],
  },

  js.configs.recommended,
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,

  {
    plugins: {
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        React: 'readonly',
        JSX: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      // console.error/warn 是自架部署的重要診斷輸出，明確放行；
      // 僅攔截 console.log/debug，避免除錯訊息汙染 production 日誌。
      // （放行前全專案 50 個檔案整檔停用本規則，等同完全失效。）
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // eslint-plugin-react-hooks v7 的 React Compiler 前置規則。
      // 2026-07 已全面重構啟用：prop 同步改為 render 期調整狀態、
      // 瀏覽器端一次性讀取改用 useClientValue/useMounted
      // （src/hooks/useClientMount.ts）。少數合理例外（掛載抓取、
      // URL 驅動協調、播放器錯誤信號）以行內註解豁免並附說明。
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/purity': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/static-components': 'error',
      'react-hooks/incompatible-library': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'react/no-unescaped-entities': 'off',

      'react/display-name': 'off',
      'react/jsx-curly-brace-presence': [
        'warn',
        { props: 'never', children: 'never' },
      ],

      //#region  //*=========== Unused Import ===========
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'warn',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          // v4 起預設檢查 catch 參數，維持舊行為（catch (e) 不強制使用）
          caughtErrors: 'none',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      //#endregion  //*======== Unused Import ===========

      //#region  //*=========== Import Sort ===========
      'simple-import-sort/exports': 'warn',
      'simple-import-sort/imports': [
        'warn',
        {
          groups: [
            // ext library & side effect imports
            ['^@?\\w', '^\\u0000'],
            // {s}css files
            ['^.+\\.s?css$'],
            // Lib and hooks
            ['^@/lib', '^@/hooks'],
            // static data
            ['^@/data'],
            // components
            ['^@/components', '^@/container'],
            // zustand store
            ['^@/store'],
            // Other imports
            ['^@/'],
            // relative paths up until 3 level
            [
              '^\\./?$',
              '^\\.(?!/?$)',
              '^\\.\\./?$',
              '^\\.\\.(?!/?$)',
              '^\\.\\./\\.\\./?$',
              '^\\.\\./\\.\\.(?!/?$)',
              '^\\.\\./\\.\\./\\.\\./?$',
              '^\\.\\./\\.\\./\\.\\.(?!/?$)',
            ],
            ['^@/types'],
            // other that didnt fit in
            ['^'],
          ],
        },
      ],
      //#endregion  //*======== Import Sort ===========
    },
  },
];
