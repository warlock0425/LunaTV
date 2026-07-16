import { expect, Page, test } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="password"]').fill('e2e-test-password');
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

test('explains Taiwan-to-mainland title mapping', async ({ page }) => {
  await login(page);
  await page.goto('/search?q=間諜家家酒');
  await expect(page.getByText('间谍过家家')).toBeVisible();
});

test('mobile navigation exposes secondary destinations through More', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'));
  await login(page);
  await page.goto('/search?q=間諜家家酒');
  await page.getByRole('button', { name: /^篩選/ }).click();
  await expect(
    page.getByRole('heading', { name: '篩選搜尋結果' })
  ).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('heading', { name: '篩選搜尋結果' })
  ).toBeHidden();
  await page.goto('/');
  await page.getByRole('button', { name: '更多' }).click();
  await expect(page.getByRole('heading', { name: '更多功能' })).toBeVisible();
  await expect(page.getByRole('link', { name: '收藏夾' })).toBeVisible();
  await expect(page.getByRole('link', { name: '觀看記錄' })).toBeVisible();
  await expect(page.getByRole('link', { name: '本機設定' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '更多功能' })).toBeHidden();
});
