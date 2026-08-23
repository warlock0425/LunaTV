/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

import { db } from '@/lib/db';

import { AdminConfig } from './admin.types';
import { toDisplayLanguage } from './chinese';
import { DEFAULT_SITE_NAME, isLegacyDefaultSiteName } from './site-defaults';
import { getServerStorageType } from './storage-runtime';
import { fetchSafeRemoteUrl, readResponseTextWithLimit } from './url-safety';

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

export interface LiveCfg {
  name: string;
  url: string;
  ua?: string;
  epg?: string; // 節目單
}

type ConfigUser = AdminConfig['UserConfig']['Users'][number];

export interface ConfigFileStruct {
  cache_time?: number;
  api_site?: {
    [key: string]: ApiSite;
  };
  custom_category?: {
    name?: string;
    type: 'movie' | 'tv';
    query: string;
  }[];
  lives?: {
    [key: string]: LiveCfg;
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function parseConfigFile(configFile: string): ConfigFileStruct {
  const parsed: unknown = JSON.parse(configFile);
  if (!isPlainRecord(parsed)) {
    throw new Error('設定檔根節點必須是物件');
  }

  if (
    parsed.cache_time !== undefined &&
    (typeof parsed.cache_time !== 'number' ||
      !Number.isFinite(parsed.cache_time) ||
      parsed.cache_time < 0)
  ) {
    throw new Error('cache_time 必須是非負數字');
  }

  if (parsed.api_site !== undefined) {
    if (!isPlainRecord(parsed.api_site)) {
      throw new Error('api_site 必須是物件');
    }
    for (const [key, site] of Object.entries(parsed.api_site)) {
      if (
        !/^[A-Za-z0-9._:-]{1,128}$/.test(key) ||
        !isPlainRecord(site) ||
        typeof site.name !== 'string' ||
        !site.name.trim() ||
        typeof site.api !== 'string' ||
        !site.api.trim() ||
        (site.detail !== undefined && typeof site.detail !== 'string')
      ) {
        throw new Error(`api_site.${key || '<empty>'} 格式錯誤`);
      }
    }
  }

  if (parsed.custom_category !== undefined) {
    if (!Array.isArray(parsed.custom_category)) {
      throw new Error('custom_category 必須是陣列');
    }
    parsed.custom_category.forEach((category, index) => {
      if (
        !isPlainRecord(category) ||
        (category.name !== undefined && typeof category.name !== 'string') ||
        (category.type !== 'movie' && category.type !== 'tv') ||
        typeof category.query !== 'string' ||
        !category.query.trim()
      ) {
        throw new Error(`custom_category[${index}] 格式錯誤`);
      }
    });
  }

  if (parsed.lives !== undefined) {
    if (!isPlainRecord(parsed.lives)) {
      throw new Error('lives 必須是物件');
    }
    for (const [key, live] of Object.entries(parsed.lives)) {
      if (
        !/^[A-Za-z0-9._:-]{1,128}$/.test(key) ||
        !isPlainRecord(live) ||
        typeof live.name !== 'string' ||
        !live.name.trim() ||
        typeof live.url !== 'string' ||
        !live.url.trim() ||
        (live.ua !== undefined && typeof live.ua !== 'string') ||
        (live.epg !== undefined && typeof live.epg !== 'string')
      ) {
        throw new Error(`lives.${key || '<empty>'} 格式錯誤`);
      }
    }
  }

  return parsed as ConfigFileStruct;
}

export const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    pagePath: '?ac=videolist&wd={query}&pg={page}',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

// 在模塊載入時根據環境決定設定來源
let cachedConfig: AdminConfig;
let cachedConfigTimestamp = 0;
const CONFIG_CACHE_TTL = 300 * 1000; // 5 分鐘快取 TTL
const CONFIG_SUBSCRIPTION_TIMEOUT_MS = 15000;
const MAX_CONFIG_SUBSCRIPTION_BYTES = 2 * 1024 * 1024;

export async function fetchSubscriptionConfigFile(
  url: string
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    CONFIG_SUBSCRIPTION_TIMEOUT_MS
  );
  let response: Response;
  try {
    response = await fetchSafeRemoteUrl(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(
        `訂閱請求失敗: ${response.status} ${response.statusText}`
      );
    }

    const configContent = await readResponseTextWithLimit(
      response,
      MAX_CONFIG_SUBSCRIPTION_BYTES
    );

    let decodedContent: string;
    try {
      const bs58 = (await import('bs58')).default;
      const decodedBytes = bs58.decode(configContent.trim());
      decodedContent = new TextDecoder().decode(decodedBytes);
    } catch (decodeError) {
      console.warn('Base58 解碼失敗:', decodeError);
      throw decodeError;
    }

    try {
      parseConfigFile(decodedContent);
    } catch (e) {
      throw new Error('訂閱設定格式錯誤，請檢查 JSON 語法');
    }

    return decodedContent;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 從設定檔合併片源／分類／直播源到管理設定。
 *
 * 安全契約（訂閱 cron 與管理端共用）：
 * - ConfigFile 無法 parse 時**拋錯中止**，不得用空物件繼續跑——否則所有
 *   `from: 'config'` 會被誤標成 `custom`，管理端「訂閱源不可刪」保護消失。
 * - 回傳新物件，不就地改動傳入的 adminConfig（避免改到 getConfig 快取本體）。
 */
export function refineConfig(adminConfig: AdminConfig): AdminConfig {
  let fileConfig: ConfigFileStruct;
  try {
    fileConfig = parseConfigFile(adminConfig.ConfigFile);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`設定檔無法解析，已中止合併以免改寫片源標記：${detail}`);
  }

  // 不就地改呼叫端傳入的物件（尤其是 getConfig() 回傳的快取本體）
  const result: AdminConfig = structuredClone(adminConfig);

  // 合併檔案中的源資訊
  const apiSitesFromFile = Object.entries(fileConfig.api_site || []);
  const currentApiSites = new Map(
    (result.SourceConfig || []).map((s) => [s.key, s])
  );

  apiSitesFromFile.forEach(([key, site]) => {
    const existingSource = currentApiSites.get(key);
    if (existingSource) {
      // 如果已存在，只覆蓋 name、api、detail 和 from（保留 disabled 等）
      existingSource.name = toDisplayLanguage(site.name);
      existingSource.api = site.api;
      existingSource.detail = site.detail;
      existingSource.from = 'config';
    } else {
      currentApiSites.set(key, {
        key,
        name: toDisplayLanguage(site.name),
        api: site.api,
        detail: site.detail,
        from: 'config',
        disabled: false,
      });
    }
  });

  // 檢查現有源是否在 fileConfig.api_site 中，如果不在則標記為 custom
  const apiSitesFromFileKey = new Set(apiSitesFromFile.map(([key]) => key));
  currentApiSites.forEach((source) => {
    if (!apiSitesFromFileKey.has(source.key)) {
      source.from = 'custom';
    }
  });

  result.SourceConfig = Array.from(currentApiSites.values());

  // 覆蓋 CustomCategories
  const customCategoriesFromFile = fileConfig.custom_category || [];
  const currentCustomCategories = new Map(
    (result.CustomCategories || []).map((c) => [c.query + c.type, c])
  );

  customCategoriesFromFile.forEach((category) => {
    const key = category.query + category.type;
    const existedCategory = currentCustomCategories.get(key);
    if (existedCategory) {
      existedCategory.name = category.name;
      existedCategory.query = category.query;
      existedCategory.type = category.type;
      existedCategory.from = 'config';
    } else {
      currentCustomCategories.set(key, {
        name: category.name,
        type: category.type,
        query: category.query,
        from: 'config',
        disabled: false,
      });
    }
  });

  const customCategoriesFromFileKeys = new Set(
    customCategoriesFromFile.map((c) => c.query + c.type)
  );
  currentCustomCategories.forEach((category) => {
    if (!customCategoriesFromFileKeys.has(category.query + category.type)) {
      category.from = 'custom';
    }
  });

  result.CustomCategories = Array.from(currentCustomCategories.values());

  const livesFromFile = Object.entries(fileConfig.lives || {});
  const currentLives = new Map(
    (result.LiveConfig || []).map((l) => [l.key, l])
  );
  livesFromFile.forEach(([key, site]) => {
    const existingLive = currentLives.get(key);
    if (existingLive) {
      existingLive.name = toDisplayLanguage(site.name);
      existingLive.url = site.url;
      existingLive.ua = site.ua;
      existingLive.epg = site.epg;
      existingLive.from = 'config';
    } else {
      currentLives.set(key, {
        key,
        name: toDisplayLanguage(site.name),
        url: site.url,
        ua: site.ua,
        epg: site.epg,
        channelNumber: 0,
        from: 'config',
        disabled: false,
      });
    }
  });

  const livesFromFileKeys = new Set(livesFromFile.map(([key]) => key));
  currentLives.forEach((live) => {
    if (!livesFromFileKeys.has(live.key)) {
      live.from = 'custom';
    }
  });

  result.LiveConfig = Array.from(currentLives.values());

  return result;
}

async function getInitConfig(
  configFile: string,
  subConfig: {
    URL: string;
    AutoUpdate: boolean;
    LastCheck: string;
  } = {
    URL: '',
    AutoUpdate: false,
    LastCheck: '',
  }
): Promise<AdminConfig> {
  let cfgFile: ConfigFileStruct;
  try {
    cfgFile = parseConfigFile(configFile);
  } catch (e) {
    cfgFile = {} as ConfigFileStruct;
  }
  const adminConfig: AdminConfig = {
    ConfigFile: configFile,
    ConfigSubscription: subConfig,
    SiteConfig: {
      SiteName: process.env.NEXT_PUBLIC_SITE_NAME || DEFAULT_SITE_NAME,
      Announcement:
        process.env.ANNOUNCEMENT ||
        '本網站僅提供影視資訊搜尋服務，所有內容均來自第三方網站。本站不儲存任何影片資源，不對任何內容的準確性、合法性、完整性負責。',
      SearchDownstreamMaxPage:
        Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
      SiteInterfaceCacheTime: cfgFile.cache_time || 7200,
      DoubanProxyType:
        process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'cmliussss-cdn-tencent',
      DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
      DoubanImageProxyType:
        process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE ||
        'cmliussss-cdn-tencent',
      DoubanImageProxy: process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '',
      DisableYellowFilter:
        process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
      FluidSearch: process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false',
      EnableWebLive: false,
      PreferValidatedSourceOrder: false,
    },
    UserConfig: {
      Users: [],
    },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
  };

  // 補充使用者資訊
  let userNames: string[] = [];
  try {
    userNames = await db.getAllUsers();
  } catch (e) {
    console.error('取得使用者列表失敗:', e);
  }
  const allUsers = userNames
    .filter((u) => u !== process.env.USERNAME)
    .map((u) => ({
      username: u,
      role: 'user',
      banned: false,
    }));
  allUsers.unshift({
    username: process.env.USERNAME!,
    role: 'owner',
    banned: false,
  });
  adminConfig.UserConfig.Users = allUsers as any;

  // 從設定檔中補充源資訊
  Object.entries(cfgFile.api_site || []).forEach(([key, site]) => {
    adminConfig.SourceConfig.push({
      key: key,
      name: toDisplayLanguage(site.name),
      api: site.api,
      detail: site.detail,
      from: 'config',
      disabled: false,
    });
  });

  // 從設定檔中補充自定義分類資訊
  cfgFile.custom_category?.forEach((category) => {
    adminConfig.CustomCategories.push({
      name: category.name || category.query,
      type: category.type,
      query: category.query,
      from: 'config',
      disabled: false,
    });
  });

  // 從設定檔中補充直播源資訊
  Object.entries(cfgFile.lives || []).forEach(([key, live]) => {
    if (!adminConfig.LiveConfig) {
      adminConfig.LiveConfig = [];
    }
    adminConfig.LiveConfig.push({
      key,
      name: toDisplayLanguage(live.name),
      url: live.url,
      ua: live.ua,
      epg: live.epg,
      channelNumber: 0,
      from: 'config',
      disabled: false,
    });
  });

  return adminConfig;
}

/**
 * 快取過期時的重新載入。以 Promise 去重，避免同時湧入的請求各自打一次
 * 資料庫——getConfig 有 24 個 API route 在呼叫，其中包含播放時每個影片
 * 分片都會經過的 /api/proxy/segment，TTL 一到就是一波驚群。
 */
let configReloadPromise: Promise<AdminConfig> | null = null;

async function reloadConfig(): Promise<AdminConfig> {
  // 讀 db
  let adminConfig: AdminConfig | null = null;
  try {
    adminConfig = await db.getAdminConfig();
  } catch (e) {
    console.error('取得管理員設定失敗:', e);
  }
  const loadedFromDb = adminConfig !== null;

  // db 中無設定，執行一次初始化
  if (!adminConfig) {
    let defaultConfigFileContent = '';
    try {
      if (typeof window === 'undefined') {
        const fs = require('fs');
        const path = require('path');
        const envConfigPath = process.env.CONFIG_FILE_PATH;
        const configPath = envConfigPath
          ? path.resolve(process.cwd(), envConfigPath)
          : path.join(process.cwd(), 'config.json');
        if (fs.existsSync(configPath)) {
          defaultConfigFileContent = fs.readFileSync(configPath, 'utf-8');
        }
      }
    } catch (err) {
      console.error('Failed to load default config:', err);
    }
    adminConfig = await getInitConfig(defaultConfigFileContent);
  }

  // 自我修復前後若無差異就不必寫回。原本每次快取過期都會把整份設定
  // 重寫一遍，等於每 5 分鐘被動產生一次寫入，而絕大多數情況根本沒改動。
  // 但首次初始化（db 尚無設定）一定要落地，否則每個請求都會重跑
  // getInitConfig（讀 config.json + 撈使用者清單），設定也永遠不會存進 db。
  const before = loadedFromDb ? safeSerializeConfig(adminConfig) : null;
  adminConfig = configSelfCheck(adminConfig);
  const after = safeSerializeConfig(adminConfig);

  // 先更新記憶體快取（讀路徑可立刻用）；若需持久化則在鎖內重讀再寫，避免 lost-update
  cachedConfig = adminConfig;
  cachedConfigTimestamp = Date.now();

  if (before === null || before !== after) {
    try {
      await db.withAdminConfigLock(async () => {
        // 鎖內重讀：鎖外期間管理端可能已改過設定
        const fresh = await db.getAdminConfig();
        if (!fresh) {
          // 首次初始化：落地本次建好的設定
          await db.saveAdminConfig(adminConfig!);
          cachedConfig = adminConfig;
          cachedConfigTimestamp = Date.now();
          return;
        }
        const beforeLock = safeSerializeConfig(fresh);
        const repaired = configSelfCheck(fresh);
        const afterLock = safeSerializeConfig(repaired);
        if (beforeLock === afterLock) {
          // 他方已修好或無需修復——用最新 DB 狀態更新快取
          cachedConfig = repaired;
          cachedConfigTimestamp = Date.now();
          return;
        }
        await db.saveAdminConfig(repaired);
        cachedConfig = repaired;
        cachedConfigTimestamp = Date.now();
      });
    } catch (error) {
      console.error('儲存自我修復後的管理員設定失敗:', error);
    }
  }

  return cachedConfig;
}

function safeSerializeConfig(config: AdminConfig | null): string {
  try {
    return JSON.stringify(config);
  } catch {
    // 序列化失敗（理論上不該發生）就回傳不同的哨兵值，讓寫回照舊執行
    return Math.random().toString(36);
  }
}

export async function getConfig(): Promise<AdminConfig> {
  // 使用內存快取，帶 TTL 過期檢查
  if (cachedConfig && Date.now() - cachedConfigTimestamp < CONFIG_CACHE_TTL) {
    return cachedConfig;
  }

  if (configReloadPromise) return configReloadPromise;

  configReloadPromise = reloadConfig().finally(() => {
    configReloadPromise = null;
  });
  return configReloadPromise;
}

export async function getFreshConfig(): Promise<AdminConfig> {
  const persisted = await db.getAdminConfig();
  if (!persisted) return getConfig();
  return configSelfCheck(persisted);
}

export async function getFreshAdminUser(
  username?: string
): Promise<ConfigUser | null> {
  if (!username) return null;
  if (username === process.env.USERNAME) {
    return { username, role: 'owner', banned: false };
  }
  const config = await getFreshConfig();
  const user = config.UserConfig.Users.find(
    (entry) => entry.username === username
  );
  return user && user.role === 'admin' && !user.banned ? user : null;
}

export function configSelfCheck(adminConfig: AdminConfig): AdminConfig {
  if (!process.env.USERNAME) {
    throw new Error('USERNAME environment variable is required');
  }

  // 確保必要的屬性存在和初始化
  if (!isPlainRecord(adminConfig.SiteConfig as unknown)) {
    adminConfig.SiteConfig = {
      SiteName: DEFAULT_SITE_NAME,
      Announcement:
        '本網站僅提供影視資訊搜尋服務，所有內容均來自第三方網站。本站不儲存任何影片資源，不對任何內容的準確性、合法性、完整性負責。',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 7200,
      DoubanProxyType: 'cmliussss-cdn-tencent',
      DoubanProxy: '',
      DoubanImageProxyType: 'cmliussss-cdn-tencent',
      DoubanImageProxy: '',
      DisableYellowFilter: false,
      FluidSearch: true,
      EnableWebLive: false,
      PreferValidatedSourceOrder: false,
    };
  }
  if (
    !adminConfig.SiteConfig.SiteName ||
    isLegacyDefaultSiteName(adminConfig.SiteConfig.SiteName)
  ) {
    adminConfig.SiteConfig.SiteName =
      process.env.NEXT_PUBLIC_SITE_NAME?.trim() || DEFAULT_SITE_NAME;
  }
  if (typeof adminConfig.SiteConfig.Announcement !== 'string') {
    adminConfig.SiteConfig.Announcement = '';
  }
  const downstreamPages = Number(
    adminConfig.SiteConfig.SearchDownstreamMaxPage
  );
  adminConfig.SiteConfig.SearchDownstreamMaxPage =
    Number.isInteger(downstreamPages) && downstreamPages >= 1
      ? Math.min(downstreamPages, 20)
      : 5;
  const interfaceCacheTime = Number(
    adminConfig.SiteConfig.SiteInterfaceCacheTime
  );
  adminConfig.SiteConfig.SiteInterfaceCacheTime =
    Number.isFinite(interfaceCacheTime) && interfaceCacheTime >= 0
      ? interfaceCacheTime
      : 7200;
  if (typeof adminConfig.SiteConfig.FluidSearch !== 'boolean') {
    adminConfig.SiteConfig.FluidSearch = true;
  }
  if (typeof adminConfig.SiteConfig.DisableYellowFilter !== 'boolean') {
    adminConfig.SiteConfig.DisableYellowFilter = false;
  }
  if (typeof adminConfig.SiteConfig.EnableWebLive !== 'boolean') {
    adminConfig.SiteConfig.EnableWebLive = false;
  }
  if (typeof adminConfig.SiteConfig.PreferValidatedSourceOrder !== 'boolean') {
    adminConfig.SiteConfig.PreferValidatedSourceOrder = false;
  }
  if (typeof adminConfig.SiteConfig.DoubanProxyType !== 'string') {
    adminConfig.SiteConfig.DoubanProxyType = 'cmliussss-cdn-tencent';
  }
  if (typeof adminConfig.SiteConfig.DoubanProxy !== 'string') {
    adminConfig.SiteConfig.DoubanProxy = '';
  }
  if (typeof adminConfig.SiteConfig.DoubanImageProxyType !== 'string') {
    adminConfig.SiteConfig.DoubanImageProxyType = 'cmliussss-cdn-tencent';
  }
  if (typeof adminConfig.SiteConfig.DoubanImageProxy !== 'string') {
    adminConfig.SiteConfig.DoubanImageProxy = '';
  }

  if (!isPlainRecord(adminConfig.UserConfig as unknown)) {
    adminConfig.UserConfig = { Users: [] };
  }
  if (
    !adminConfig.UserConfig.Users ||
    !Array.isArray(adminConfig.UserConfig.Users)
  ) {
    adminConfig.UserConfig.Users = [];
  }
  if (!adminConfig.SourceConfig || !Array.isArray(adminConfig.SourceConfig)) {
    adminConfig.SourceConfig = [];
  }
  if (
    !adminConfig.CustomCategories ||
    !Array.isArray(adminConfig.CustomCategories)
  ) {
    adminConfig.CustomCategories = [];
  }
  if (!adminConfig.LiveConfig || !Array.isArray(adminConfig.LiveConfig)) {
    adminConfig.LiveConfig = [];
  }

  adminConfig.UserConfig.Users = (
    adminConfig.UserConfig.Users as unknown[]
  ).flatMap((rawUser) => {
    if (
      !isPlainRecord(rawUser) ||
      typeof rawUser.username !== 'string' ||
      !rawUser.username.trim()
    ) {
      return [];
    }
    const role =
      rawUser.role === 'admin' || rawUser.role === 'owner'
        ? rawUser.role
        : 'user';
    return [
      {
        username: rawUser.username,
        role,
        banned: rawUser.banned === true,
        enabledApis: cleanStringArray(rawUser.enabledApis),
        tags: cleanStringArray(rawUser.tags),
      },
    ];
  });

  const rawTags = (adminConfig.UserConfig as { Tags?: unknown }).Tags;
  adminConfig.UserConfig.Tags = Array.isArray(rawTags)
    ? rawTags.flatMap((rawTag) => {
        if (
          !isPlainRecord(rawTag) ||
          typeof rawTag.name !== 'string' ||
          !rawTag.name.trim()
        ) {
          return [];
        }
        return [
          {
            name: rawTag.name,
            enabledApis: cleanStringArray(rawTag.enabledApis) || [],
          },
        ];
      })
    : undefined;

  adminConfig.SourceConfig = (adminConfig.SourceConfig as unknown[]).flatMap(
    (rawSource) => {
      if (
        !isPlainRecord(rawSource) ||
        typeof rawSource.key !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(rawSource.key) ||
        typeof rawSource.name !== 'string' ||
        !rawSource.name.trim() ||
        typeof rawSource.api !== 'string' ||
        !rawSource.api.trim()
      ) {
        return [];
      }
      return [
        {
          key: rawSource.key,
          name: rawSource.name,
          api: rawSource.api,
          detail:
            typeof rawSource.detail === 'string' ? rawSource.detail : undefined,
          from: rawSource.from === 'config' ? 'config' : 'custom',
          disabled: rawSource.disabled === true,
        },
      ];
    }
  );

  adminConfig.CustomCategories = (
    adminConfig.CustomCategories as unknown[]
  ).flatMap((rawCategory) => {
    if (
      !isPlainRecord(rawCategory) ||
      (rawCategory.type !== 'movie' && rawCategory.type !== 'tv') ||
      typeof rawCategory.query !== 'string' ||
      !rawCategory.query.trim()
    ) {
      return [];
    }
    return [
      {
        name:
          typeof rawCategory.name === 'string' ? rawCategory.name : undefined,
        type: rawCategory.type,
        query: rawCategory.query,
        from: rawCategory.from === 'config' ? 'config' : 'custom',
        disabled: rawCategory.disabled === true,
      },
    ];
  });

  adminConfig.LiveConfig = (adminConfig.LiveConfig as unknown[]).flatMap(
    (rawLive) => {
      if (
        !isPlainRecord(rawLive) ||
        typeof rawLive.key !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(rawLive.key) ||
        typeof rawLive.name !== 'string' ||
        !rawLive.name.trim() ||
        typeof rawLive.url !== 'string' ||
        !rawLive.url.trim()
      ) {
        return [];
      }
      return [
        {
          key: rawLive.key,
          name: rawLive.name,
          url: rawLive.url,
          ua: typeof rawLive.ua === 'string' ? rawLive.ua : undefined,
          epg: typeof rawLive.epg === 'string' ? rawLive.epg : undefined,
          from: rawLive.from === 'config' ? 'config' : 'custom',
          channelNumber:
            typeof rawLive.channelNumber === 'number' &&
            Number.isFinite(rawLive.channelNumber)
              ? rawLive.channelNumber
              : 0,
          disabled: rawLive.disabled === true,
        },
      ];
    }
  );

  // 站長變更自檢
  const ownerUser = process.env.USERNAME;

  // 去重
  const seenUsernames = new Set<string>();
  adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter((user) => {
    if (seenUsernames.has(user.username)) {
      return false;
    }
    seenUsernames.add(user.username);
    return true;
  });
  // 過濾站長
  const originOwnerCfg = adminConfig.UserConfig.Users.find(
    (u) => u.username === ownerUser
  );
  adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter(
    (user) => user.username !== ownerUser
  );
  // 其他使用者不得擁有 owner 權限
  adminConfig.UserConfig.Users.forEach((user) => {
    if (user.role === 'owner') {
      user.role = 'user';
    }
  });
  // 重新新增回站長
  adminConfig.UserConfig.Users.unshift({
    username: ownerUser!,
    role: 'owner',
    banned: false,
    enabledApis: originOwnerCfg?.enabledApis || undefined,
    tags: originOwnerCfg?.tags || undefined,
  });

  // 採集源去重
  const seenSourceKeys = new Set<string>();
  adminConfig.SourceConfig = adminConfig.SourceConfig.filter((source) => {
    if (seenSourceKeys.has(source.key)) {
      return false;
    }
    seenSourceKeys.add(source.key);
    return true;
  });

  // 自定義分類去重
  const seenCustomCategoryKeys = new Set<string>();
  adminConfig.CustomCategories = adminConfig.CustomCategories.filter(
    (category) => {
      if (seenCustomCategoryKeys.has(category.query + category.type)) {
        return false;
      }
      seenCustomCategoryKeys.add(category.query + category.type);
      return true;
    }
  );

  // 直播源去重
  const seenLiveKeys = new Set<string>();
  adminConfig.LiveConfig = adminConfig.LiveConfig.filter((live) => {
    if (seenLiveKeys.has(live.key)) {
      return false;
    }
    seenLiveKeys.add(live.key);
    return true;
  });

  return adminConfig;
}

export async function resetConfig() {
  const originConfig = await db.getAdminConfig();
  const subscription = originConfig?.ConfigSubscription;
  const subscriptionUrl = subscription?.URL?.trim();

  if (!originConfig || !subscription || !subscriptionUrl) {
    throw new Error('目前未設定訂閱來源，無法安全重置');
  }

  // 網路抓取在鎖外，避免長時間卡住其他設定寫入
  const decodedContent = await fetchSubscriptionConfigFile(subscriptionUrl);

  await db.withAdminConfigLock(async () => {
    // 鎖內重讀：鎖外抓取期間管理端可能改過訂閱以外的欄位
    const fresh = await db.getAdminConfig();
    if (!fresh?.ConfigSubscription?.URL?.trim()) {
      throw new Error('目前未設定訂閱來源，無法安全重置');
    }
    const adminConfig = refineConfig({
      ...fresh,
      ConfigFile: decodedContent,
      ConfigSubscription: {
        ...fresh.ConfigSubscription,
        LastCheck: new Date().toISOString(),
      },
    });

    // 先持久化成功再更新記憶體快取，避免 DB 寫入失敗時快取已是新設定
    await db.saveAdminConfig(adminConfig);
    cachedConfig = adminConfig;
    cachedConfigTimestamp = Date.now();
  });

  return;
}

export async function getCacheTime(): Promise<number> {
  const config = await getConfig();
  return config.SiteConfig.SiteInterfaceCacheTime || 7200;
}

/**
 * 依使用者權限篩可用片源（純函式，便於守門）。
 *
 * `enabledApis` 語意必須分開——不可用 `length > 0` 把兩者擠在一起：
 * - 欄位不存在 / `undefined`：未設定 → tags → 全部（歷史行為）
 * - `[]`：明確零權限 → 回空陣列（刪源濾掉最後一個 key 時會落到此）
 * - `['a','b']`：白名單
 *
 * 管理端「取消全部勾選」會 delete 欄位（不是存 `[]`），見 updateUserApis。
 */
export function selectAvailableApiSites(
  config: AdminConfig,
  user: string | undefined,
  options?: { isLocalStorageMode?: boolean }
): ApiSite[] {
  const allApiSites = config.SourceConfig.filter((s) => !s.disabled);

  if (!user) {
    return allApiSites;
  }

  if (user === 'localstorage') {
    return options?.isLocalStorageMode ? allApiSites : [];
  }

  const userConfig = config.UserConfig.Users.find((u) => u.username === user);
  if (!userConfig || userConfig.banned) {
    return [];
  }

  // 有陣列＝已設定過白名單（含空＝零權限）；未設定才落到 tags / 全部
  if (Array.isArray(userConfig.enabledApis)) {
    const userApiSitesSet = new Set(userConfig.enabledApis);
    return allApiSites
      .filter((s) => userApiSitesSet.has(s.key))
      .map((s) => ({
        key: s.key,
        name: s.name,
        api: s.api,
        detail: s.detail,
      }));
  }

  // 未設定 enabledApis：依 tags 查找
  if (userConfig.tags && userConfig.tags.length > 0 && config.UserConfig.Tags) {
    const enabledApisFromTags = new Set<string>();

    userConfig.tags.forEach((tagName) => {
      const tagConfig = config.UserConfig.Tags?.find((t) => t.name === tagName);
      if (tagConfig && tagConfig.enabledApis) {
        tagConfig.enabledApis.forEach((apiKey) =>
          enabledApisFromTags.add(apiKey)
        );
      }
    });

    if (enabledApisFromTags.size > 0) {
      return allApiSites
        .filter((s) => enabledApisFromTags.has(s.key))
        .map((s) => ({
          key: s.key,
          name: s.name,
          api: s.api,
          detail: s.detail,
        }));
    }
  }

  // 未設定白名單也無有效 tags → 全部可用源
  return allApiSites;
}

export async function getAvailableApiSites(user?: string): Promise<ApiSite[]> {
  const config = await getConfig();
  return selectAvailableApiSites(config, user, {
    isLocalStorageMode: getServerStorageType() === 'localstorage',
  });
}

/** @fires-and-forget */
export async function setCachedConfig(config: AdminConfig) {
  cachedConfig = config;
  cachedConfigTimestamp = Date.now();
}
