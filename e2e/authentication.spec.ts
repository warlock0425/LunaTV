import { expect, test } from '@playwright/test';

test('redirects guests to login and completes local login', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);

  const password = page.locator('input[type="password"]');
  await expect(password).toBeVisible();
  await password.fill('e2e-test-password');
  await page.getByRole('button', { name: /登入|登錄/ }).click();
  // 較慢的本機或 CI 環境可能超過 Playwright 預設 5 秒。
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
});

test('does not expose authenticated APIs to guests', async ({ request }) => {
  const response = await request.get('/api/search?q=測試');
  expect(response.status()).toBe(401);
});
