import { expect, Page, test } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder(/密碼|password/i).fill('e2e-test-password');
  await page.getByRole('button', { name: /登入|login/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

const RECORDS = {
  'ffzy+12345': {
    title: '世界最強の後衛～迷宮國的新手攻略者～',
    source_name: '艾旦影視',
    cover: '',
    // downstream 抓不到年份時填的哨兵值，不該顯示在畫面上
    year: 'unknown',
    index: 2,
    total_episodes: 3,
    play_time: 640,
    total_time: 1440,
    save_time: Date.now(),
    search_title: '世界最強の後衛',
  },
  'ffzy+22222': {
    title: '轉學後班上的清純可愛美少女',
    source_name: '非凡資源',
    cover: '',
    year: '2026',
    index: 2,
    total_episodes: 2,
    play_time: 300,
    total_time: 1400,
    save_time: Date.now() - 60_000,
    search_title: '轉學後班上的清純可愛美少女',
  },
  'ffzy+33333': {
    title: '骸骨騎士大人異世界冒險中',
    source_name: '非凡資源',
    cover: '',
    year: '2026',
    index: 5,
    total_episodes: 12,
    play_time: 200,
    total_time: 1400,
    save_time: Date.now() - 120_000,
    search_title: '骸骨騎士大人異世界冒險中',
  },
};

test('接著看區塊鎖定最後觀看的一部，且不與下方列表重複', async ({ page }) => {
  await login(page);

  await page.evaluate((records) => {
    localStorage.setItem('moontv_play_records', JSON.stringify(records));
  }, RECORDS);

  await page.goto('/');

  // hero 取 save_time 最新的那筆
  await expect(page.getByText('接著看', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('heading', { name: /世界最強/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /繼續播放/ })).toBeVisible();
  await expect(page.getByText(/另外還有 2 部在追/)).toBeVisible();
  // 年份是 'unknown' 時整段不顯示，不能把哨兵值印給使用者看
  await expect(page.getByText('unknown')).toHaveCount(0);

  // hero 那部不再出現在下方列表（列卡片標題用 h3，hero 用 h2），其餘仍在
  await expect(page.locator('h3', { hasText: '世界最強' })).toHaveCount(0);
  await expect(page.locator('h3', { hasText: '骸骨騎士' })).toHaveCount(1);
  await expect(page.locator('h3', { hasText: '轉學後班上' })).toHaveCount(1);
});

test('只剩一筆紀錄時，清空紀錄的入口仍在（掛在 hero 上）', async ({ page }) => {
  await login(page);

  await page.evaluate((records) => {
    localStorage.setItem(
      'moontv_play_records',
      JSON.stringify({ 'ffzy+12345': records['ffzy+12345'] })
    );
  }, RECORDS);

  await page.goto('/');

  await expect(page.getByText('接著看', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  // 沒有下方列表，但清空入口不能跟著消失
  await expect(page.getByText(/另外還有/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /清空紀錄/ })).toBeVisible();
});

test('沒有觀看紀錄時不顯示接著看區塊', async ({ page }) => {
  await login(page);

  await page.evaluate(() => {
    localStorage.setItem('moontv_play_records', JSON.stringify({}));
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await expect(page.getByText('接著看', { exact: true })).toHaveCount(0);
});
