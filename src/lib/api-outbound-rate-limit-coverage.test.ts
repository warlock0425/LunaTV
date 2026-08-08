/** @jest-environment node */

import fs from 'node:fs';
import path from 'node:path';

/**
 * 結構性測試：會對外發請求（或觸發下游抓取）的 API 必須有 enforceRateLimit。
 *
 * api-auth-coverage 的 requiresRateLimit 只涵蓋「免第二道認證」的豁免端點。
 * 有認證的 live / search / detail / validate 等若漏掉限流，CI 不會紅——
 * 058e5de 修的正是這一類洞。本測試把守門擴到所有 outbound route。
 *
 * 要暫時不限流（例如播放分片）必須在 OUTBOUND_RATE_LIMIT_EXEMPTIONS
 * 留下理由，不能靜默空白。
 */

const API_ROOT = path.join(process.cwd(), 'src', 'app', 'api');

/** 出現任一標記即視為會觸發對外／下游抓取 */
const OUTBOUND_MARKERS = [
  'fetchSafeRemoteUrl(',
  'searchFromApi(',
  'getDetailFromApi(',
  'validateSourceSite(',
  'getCachedLiveChannels(',
  'fetchSubscriptionConfigFile(',
  // 直接 fetch 遠端（豆瓣、Bangumi 等）
  'await fetch(',
];

interface OutboundExemption {
  reason: string;
}

/**
 * 有理由暫不限流的 outbound 路由。
 * 新增豁免＝公開寫下「為什麼可以無限次驅動伺服器往外抓」。
 */
const OUTBOUND_RATE_LIMIT_EXEMPTIONS: Record<string, OutboundExemption> = {
  'proxy/m3u8/route.ts': {
    reason:
      '播放期間 HLS 播放清單請求；頻率與播放器行為綁定，' +
      '先觀測真實流量再定額，避免誤傷正常觀看',
  },
  'proxy/segment/route.ts': {
    reason:
      '播放期間逐片段呼叫，頻率與碼率綁定；' + '先觀測再定額，避免限流造成卡頓',
  },
  'proxy/key/route.ts': {
    reason: 'HLS 金鑰請求，與播放路徑綁定；與 m3u8/segment 同期觀測後再定額',
  },
  'proxy/logo/route.ts': {
    reason:
      '直播台標 <img> 載入，併發與頻道列表長度相關；' +
      '先觀測再定額，避免列表破圖',
  },
  'cron/route.ts': {
    reason: '以 CRON_SECRET / INTERNAL_CRON_SECRET 保護，非使用者驅動',
  },
  'bangumi/calendar/route.ts': {
    reason:
      '不收查詢參數且有全域 6 小時快取，請求多打在快取上、無參數扇出；' +
      '與 api-auth-coverage 對本端點的判斷一致',
  },
};

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

function readSource(file: string): string {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function isOutboundRoute(source: string): boolean {
  return OUTBOUND_MARKERS.some((marker) => source.includes(marker));
}

function hasRateLimit(source: string): boolean {
  return source.includes('enforceRateLimit(');
}

const routeFiles = listRouteFiles(API_ROOT);
const routes = routeFiles.map((file) => ({
  route: relativeRoute(file),
  source: readSource(file),
}));

const outboundRoutes = routes.filter((entry) => isOutboundRoute(entry.source));

describe('outbound API 必須有限流（或列入有理由的豁免）', () => {
  it('掃到的 outbound route 數量合理（避免掃描失效後空跑）', () => {
    // 目前至少含 search/detail/live/proxy/douban/bangumi 等十數支
    expect(outboundRoutes.length).toBeGreaterThanOrEqual(12);
  });

  it.each(outboundRoutes.map(({ route }) => route))(
    '%s 有 enforceRateLimit，或已列入豁免並說明理由',
    (route) => {
      const entry = outboundRoutes.find(
        (candidate) => candidate.route === route
      )!;
      const exemption = OUTBOUND_RATE_LIMIT_EXEMPTIONS[route];

      if (exemption) {
        expect(exemption.reason.length).toBeGreaterThan(15);
        return;
      }

      expect({
        route,
        hasRateLimit: hasRateLimit(entry.source),
      }).toEqual({ route, hasRateLimit: true });
    }
  );

  it('豁免清單沒有指向已不存在的 route', () => {
    const existing = new Set(routes.map(({ route }) => route));
    const stale = Object.keys(OUTBOUND_RATE_LIMIT_EXEMPTIONS).filter(
      (route) => !existing.has(route)
    );
    expect(stale).toEqual([]);
  });

  it('豁免清單沒有指向「其實不是 outbound」的 route', () => {
    const outboundSet = new Set(outboundRoutes.map(({ route }) => route));
    const notOutbound = Object.keys(OUTBOUND_RATE_LIMIT_EXEMPTIONS).filter(
      (route) => !outboundSet.has(route)
    );
    expect(notOutbound).toEqual([]);
  });

  it('058e5de 鎖定的 live / validate 必須在 outbound 集合且有限流（防回歸）', () => {
    const mustHave = [
      'live/precheck/route.ts',
      'live/epg/route.ts',
      'live/channels/route.ts',
      'admin/source/validate/route.ts',
    ];
    for (const route of mustHave) {
      const entry = routes.find((candidate) => candidate.route === route);
      expect(entry).toBeDefined();
      expect(isOutboundRoute(entry!.source)).toBe(true);
      expect(hasRateLimit(entry!.source)).toBe(true);
      expect(OUTBOUND_RATE_LIMIT_EXEMPTIONS[route]).toBeUndefined();
    }
  });

  it('proxy 分片路徑必須在豁免清單（口頭「先不碰」變成可查的契約）', () => {
    for (const route of [
      'proxy/m3u8/route.ts',
      'proxy/segment/route.ts',
      'proxy/key/route.ts',
      'proxy/logo/route.ts',
    ]) {
      expect(
        OUTBOUND_RATE_LIMIT_EXEMPTIONS[route]?.reason.length
      ).toBeGreaterThan(15);
    }
  });
});
