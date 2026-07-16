import { expect, Page, test } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="password"]').fill('e2e-test-password');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

// 播放頁在缺少必要參數時應優雅降級到錯誤畫面（PlayErrorView），
// 而非白屏或崩潰。
test('play page falls back to the error view on invalid params', async ({
  page,
}) => {
  // dev 模式下 /play 路由首次編譯較久，給足總時限涵蓋登入＋編譯＋渲染
  test.setTimeout(60_000);
  await login(page);
  await page.goto('/play');

  await expect(page.getByText('哎呀，出現了一些問題')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('缺少必要參數')).toBeVisible();
});

// Auth session 生命週期：UI 登入建立有效 session，登出後受保護 API
// 立即恢復 401。（不透過 UserMenu 點擊登出——該互動在 dev e2e 環境
// 時序不穩；此處聚焦驗證 session 本身的建立與失效。）
test('login establishes a session and logout invalidates it', async ({
  page,
  context,
}) => {
  await login(page);

  // 登入後受保護 API 可存取（非 401）
  const authed = await context.request.get('/api/search?q=測試');
  expect(authed.status()).not.toBe(401);

  // 登出後同一 session 立即失效
  await context.request.post('/api/logout');
  const guest = await context.request.get('/api/search?q=測試');
  expect(guest.status()).toBe(401);
});
