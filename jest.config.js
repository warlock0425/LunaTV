// eslint-disable-next-line @typescript-eslint/no-var-requires
const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
});

// Add any custom config to be passed to Jest
const customJestConfig = {
  // Add more setup options before each test is run
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // if using TypeScript with a baseUrl set to the root directory then you need the below for alias' to work
  moduleDirectories: ['node_modules', '<rootDir>/'],

  testEnvironment: 'jest-environment-jsdom',

  // babel 插桩與 @babel/core 8 (beta) 衝突，V8 provider 不需插桩
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/lib/**/*.{ts,tsx}',
    '!src/lib/**/*.test.ts',
    '!src/lib/version.ts',
  ],
  // 防倒退門檻（2026-07 現況：lines 48% / branches 73-75%）
  // 注意：V8 coverage 數字隨 Node 版本浮動（CI 為 Node 24），門檻需留足容差
  coverageThreshold: {
    global: {
      lines: 42,
      branches: 62,
      functions: 40,
      statements: 42,
    },
  },

  modulePathIgnorePatterns: ['<rootDir>/scratch/'],
  testPathIgnorePatterns: ['<rootDir>/e2e/'],
  // ESM-only 套件需交給 babel 轉換；(\.pnpm\/)? 讓規則同時涵蓋 pnpm 巢狀路徑
  transformIgnorePatterns: [
    '/node_modules/(?!(\\.pnpm/)?(switch-chinese|opencc-js|uncrypto))',
  ],

  /**
   * Absolute imports and Module Path Aliases
   */
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^~/(.*)$': '<rootDir>/public/$1',
    '^opencc-js/t2cn$': '<rootDir>/node_modules/opencc-js/dist/umd/t2cn.js',
    // switch-chinese 為 ESM-only 且 exports 只有 import 入口，
    // jest 29 嚴格遵守 exports 會解析失敗，直接指向實體檔案
    '^switch-chinese$': '<rootDir>/node_modules/switch-chinese/stcasc.lib.js',
  },
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = async () => {
  const config = await createJestConfig(customJestConfig)();
  config.transformIgnorePatterns = [
    '/node_modules/(?!(\\.pnpm/)?(switch-chinese|opencc-js|uncrypto))',
  ];
  return config;
};
