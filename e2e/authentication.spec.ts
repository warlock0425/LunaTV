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
  await expect(page).not.toHaveURL(/\/login/);
});

test('does not expose authenticated APIs to guests', async ({ request }) => {
  const response = await request.get('/api/search?q=測試');
  expect(response.status()).toBe(401);
});
