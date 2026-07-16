import { defineConfig, devices } from '@playwright/test';

const isStandalone = process.platform !== 'win32';

// standalone 模式下 next start 不能用，需要手動複製靜態檔並用
// node .next/standalone/server.js 啟動。此 helper 跨平台複製
// public/ 和 .next/static/ 到 standalone 目錄後啟動 server。
const standaloneCommand = [
  'node -e "',
  "const{cpSync,mkdirSync,writeFileSync}=require('fs');",
  "const p=require('path');",
  "mkdirSync(p.join('.next','standalone','.next'),{recursive:true});",
  "cpSync('public',p.join('.next','standalone','public'),{recursive:true});",
  "cpSync(p.join('.next','static'),p.join('.next','standalone','.next','static'),{recursive:true});",
  "writeFileSync(p.join('.next','standalone','.env.local'),'PASSWORD=e2e-test-password\\nNEXT_PUBLIC_STORAGE_TYPE=localstorage\\n');",
  '"',
  '&& node .next/standalone/server.js',
].join('');

const devCommand =
  'pnpm gen:manifest && pnpm exec next dev --webpack -H 127.0.0.1 -p 3100';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: isStandalone ? standaloneCommand : devCommand,
    url: 'http://127.0.0.1:3100/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      ...(isStandalone
        ? { PORT: '3100', HOSTNAME: '127.0.0.1' }
        : {}),
      USERNAME: process.env.USERNAME || 'e2e-test-admin',
      PASSWORD: 'e2e-test-password',
      NEXT_PUBLIC_STORAGE_TYPE: 'localstorage',
    },
  },
});
