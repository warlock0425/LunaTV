/** @jest-environment node */

import fs from 'node:fs';
import path from 'node:path';

/**
 * 結構性測試：讓「某支 API 同時掉出兩層防護」變成 CI 會擋下的錯誤。
 *
 * 本專案有兩層認證：
 *   第一層 src/proxy.ts（Next 16 起 middleware 更名為 proxy）——matcher 涵蓋
 *     的路徑都會先驗 cookie 簽章與 sessionVersion。
 *   第二層 各 route 自行呼叫 getVerifiedAuthInfo / requireActiveUser——
 *     api-auth.ts 的註解已說明理由：matcher 一改、或 Next.js 再出現 middleware
 *     繞過類問題（CVE-2025-29927），只有第一層就會直接失守。
 *
 * 第二層靠「每支 route 自己記得寫」，1ec87a9 就一次補了五支漏掉的。這個測試
 * 把該慣例變成硬性檢查：新增 route 而忘記驗證會直接紅燈，要豁免就得在
 * SECOND_LAYER_EXEMPTIONS 留下理由。
 */

const API_ROOT = path.join(process.cwd(), 'src', 'app', 'api');
const PROXY_FILE = path.join(process.cwd(), 'src', 'proxy.ts');

const AUTH_HELPERS = [
  'getVerifiedAuthInfo',
  'requireActiveUser',
  'requireAdmin',
  'requireOwner',
  'authorizeProxyFetch',
];
const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

interface Exemption {
  /** 為什麼這支可以不做第二道 cookie 驗證 */
  reason: string;
  /**
   * 是否必須改用限流保護。對外發出請求的端點即使不驗 cookie，也不能讓人
   * 無限次驅動伺服器往外抓——這類豁免一律要求呼叫 enforceRateLimit。
   */
  requiresRateLimit: boolean;
}

/**
 * 單一 HTTP method 豁免（整支 route 仍要驗其餘 handler）。
 * 例如只回 405 的 stub GET，不該被要求呼叫 getVerifiedAuthInfo。
 */
const HANDLER_EXEMPTIONS: Record<string, Record<string, string>> = {
  'admin/reset/route.ts': {
    GET: '僅回 405，不變更狀態；重置在 POST，且 POST 有 requireOwner + Origin 檢查',
  },
};

const SECOND_LAYER_EXEMPTIONS: Record<string, Exemption> = {
  'login/route.ts': {
    reason: '登入端點本身，尚未有 session；自帶 consumeLoginAttempt 失敗鎖定',
    requiresRateLimit: false,
  },
  'logout/route.ts': {
    reason: '預設只清除本機 cookie；?all=true 才會驗簽並 revokeUserSessions',
    requiresRateLimit: false,
  },
  'cron/route.ts': {
    reason: '以 CRON_SECRET / INTERNAL_CRON_SECRET 驗證，不走 cookie',
    requiresRateLimit: false,
  },
  'server-config/route.ts': {
    reason: '登入頁在登入前就需要；僅回傳站名、儲存型別與版本號',
    requiresRateLimit: false,
  },
  'health/route.ts': {
    reason:
      'Selene／Selene-TV 連線探測；只回 ok 與版本號，不含使用者資料或站內設定',
    requiresRateLimit: false,
  },
  'image-proxy/route.ts': {
    reason:
      '見 1ec87a9：這支是 <img src> 的目標，OrionTV 的海報也走它，' +
      'React Native 的 Image 在 Android 是否帶 cookie 並不確定，' +
      '加 cookie 驗證有實際機率讓 TV 端整片破圖',
    requiresRateLimit: true,
  },
  'douban/route.ts': {
    reason: '只代理公開中繼資料，不涉及使用者資料或本站設定',
    requiresRateLimit: true,
  },
  'douban/alias/route.ts': {
    reason: '只代理公開中繼資料，不涉及使用者資料或本站設定',
    requiresRateLimit: true,
  },
  'douban/categories/route.ts': {
    reason: '只代理公開中繼資料，不涉及使用者資料或本站設定',
    requiresRateLimit: true,
  },
  'douban/recommends/route.ts': {
    reason: '只代理公開中繼資料，不涉及使用者資料或本站設定',
    requiresRateLimit: true,
  },
  'bangumi/aliases/route.ts': {
    reason: '只代理公開中繼資料，不涉及使用者資料或本站設定',
    requiresRateLimit: true,
  },
  'bangumi/calendar/route.ts': {
    reason:
      '只代理公開中繼資料。不收任何查詢參數且有全域 6 小時快取，' +
      '所有請求都打在快取上、沒有對外扇出，因此不需要限流——' +
      '加上去只是替每個請求多付一次 Redis round-trip',
    requiresRateLimit: false,
  },
};

/**
 * proxy.ts matcher 的排除清單。這些路徑「連第一層都沒有」，是真正的公開端點，
 * 每一個都必須同時列在 SECOND_LAYER_EXEMPTIONS 裡。
 *
 * 往這裡加東西＝把一支 API 完全裸露到公網，所以刻意寫死：改動會讓測試紅燈，
 * 強迫改的人回來重新確認一次。
 */
const MUTATING_SAME_SITE_POSTS = [
  'admin/reset/route.ts',
  'admin/user/route.ts',
  'admin/site/route.ts',
  'admin/source/route.ts',
  'admin/category/route.ts',
  'admin/config_file/route.ts',
  'admin/live/route.ts',
  'admin/live/refresh/route.ts',
  'admin/source/health-reset/route.ts',
  'admin/config_subscription/fetch/route.ts',
  'admin/data_migration/import/route.ts',
  'admin/data_migration/export/route.ts',
  'change-password/route.ts',
  'logout/route.ts',
];

const EXPECTED_PROXY_EXCLUSIONS = [
  '_next/static',
  '_next/image',
  'favicon.ico',
  'sw.js',
  'login',
  'warning',
  'api/login',
  'api/register',
  'api/logout',
  'api/cron',
  'api/server-config',
  'api/health',
];

function listRouteFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listRouteFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

function relativeRoute(file: string): string {
  return path.relative(API_ROOT, file).split(path.sep).join('/');
}

interface Handler {
  method: string;
  body: string;
}

/**
 * 取出各個 HTTP handler 的函式主體。
 *
 * 依賴 prettier 的排版：handler 一律是頂層的 `export async function NAME(`，
 * 並以第 0 欄的 `}` 收尾。萬一哪天排版慣例變了，extractHandlers 會找不到
 * 收尾而讓測試失敗，不會默默放行。
 */
function extractHandlers(source: string, route: string): Handler[] {
  const lines = source.split('\n');
  const handlers: Handler[] = [];

  lines.forEach((line, index) => {
    const match = line.match(
      new RegExp(`^export async function (${HTTP_METHODS.join('|')})\\b`)
    );
    if (!match) return;

    const end = lines.findIndex((cur, i) => i > index && cur === '}');
    if (end === -1) {
      throw new Error(
        `${route}: 找不到 ${match[1]} 的結尾 '}'，extractHandlers 的排版假設已失效`
      );
    }
    handlers.push({
      method: match[1],
      body: lines.slice(index, end + 1).join('\n'),
    });
  });

  return handlers;
}

/** 統一換行：Windows 上 checkout 出來是 CRLF，逐行比對會被行尾的 \r 破壞 */
function readSource(file: string): string {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

const routeFiles = listRouteFiles(API_ROOT);
const routes = routeFiles.map((file) => ({
  route: relativeRoute(file),
  source: readSource(file),
}));

describe('API 認證覆蓋', () => {
  it('掃到的 route 數量合理（避免掃描路徑失效後空跑而假綠）', () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it.each(routes.map(({ route }) => route))(
    '%s 的每個 handler 都有第二道驗證，或已列入豁免',
    (route) => {
      const { source } = routes.find((entry) => entry.route === route)!;
      const exemption = SECOND_LAYER_EXEMPTIONS[route];
      const handlers = extractHandlers(source, route);

      expect(handlers.length).toBeGreaterThan(0);

      if (exemption) {
        expect(exemption.reason.length).toBeGreaterThan(10);
        return;
      }

      const methodExempt = HANDLER_EXEMPTIONS[route] || {};
      const missing = handlers
        .filter((handler) => {
          if (methodExempt[handler.method]) {
            expect(methodExempt[handler.method].length).toBeGreaterThan(10);
            return false;
          }
          return !AUTH_HELPERS.some((helper) =>
            handler.body.includes(`${helper}(`)
          );
        })
        .map((handler) => handler.method);

      expect({ route, missing }).toEqual({ route, missing: [] });
    }
  );

  it('豁免清單沒有指向已不存在的 route', () => {
    const existing = new Set(routes.map(({ route }) => route));
    const stale = Object.keys(SECOND_LAYER_EXEMPTIONS).filter(
      (route) => !existing.has(route)
    );
    const staleHandlers = Object.keys(HANDLER_EXEMPTIONS).filter(
      (route) => !existing.has(route)
    );

    expect(stale).toEqual([]);
    expect(staleHandlers).toEqual([]);
  });

  it('狀態變更 POST 都檢查同源 Origin', () => {
    const missing = MUTATING_SAME_SITE_POSTS.filter((route) => {
      const entry = routes.find((candidate) => candidate.route === route);
      if (!entry) return true;
      const post = extractHandlers(entry.source, route).find(
        (handler) => handler.method === 'POST'
      );
      return !post || !post.body.includes('rejectCrossSiteRequest(');
    });

    expect(missing).toEqual([]);
  });

  it('會對外發出請求的豁免端點一律有限流', () => {
    const missingRateLimit = Object.entries(SECOND_LAYER_EXEMPTIONS)
      .filter(([, exemption]) => exemption.requiresRateLimit)
      .map(([route]) => route)
      .filter((route) => {
        const entry = routes.find((candidate) => candidate.route === route);
        return !entry?.source.includes('enforceRateLimit(');
      });

    expect(missingRateLimit).toEqual([]);
  });
});

describe('proxy.ts 第一層防護', () => {
  const proxySource = readSource(PROXY_FILE);

  it('matcher 的排除清單未被更動', () => {
    const matcher = proxySource.match(/'\/\(\(\?!([^)]+)\)\.\*\)'/);
    expect(matcher).not.toBeNull();

    expect(matcher![1].split('|')).toEqual(EXPECTED_PROXY_EXCLUSIONS);
  });

  it('被排除在第一層之外的 API 都有列入第二層豁免並說明理由', () => {
    const bypassed = EXPECTED_PROXY_EXCLUSIONS.filter((entry) =>
      entry.startsWith('api/')
    ).map((entry) => `${entry.slice('api/'.length)}/route.ts`);

    // api/register 在 matcher 內但專案並未實作，list 出來即可確認它確實不存在
    const existing = new Set(routes.map(({ route }) => route));
    const undocumented = bypassed
      .filter((route) => existing.has(route))
      .filter((route) => !SECOND_LAYER_EXEMPTIONS[route]);

    expect(undocumented).toEqual([]);
  });
});
