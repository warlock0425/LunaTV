import { expect, test } from '@playwright/test';

test('serves a valid manifest and service worker', async ({ request }) => {
  const manifest = await request.get('/manifest.json');
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).name).toBeTruthy();

  const worker = await request.get('/sw.js');
  expect(worker.ok()).toBeTruthy();
  expect(await worker.text()).toContain("url.pathname.startsWith('/api/')");
});
