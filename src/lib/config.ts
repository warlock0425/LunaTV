/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-require-imports */

import { db } from '@/lib/db';

import { AdminConfig } from './admin.types';
import { toDisplayLanguage } from './chinese';
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

interface ConfigFileStruct {
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

// 在模塊加載時根據環境決定配置來源
let cachedConfig: AdminConfig;
let cachedConfigTimestamp = 0;
const CONFIG_CACHE_TTL = 300 * 1000; // 5 分鐘緩存 TTL
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
      JSON.parse(decodedContent);
    } catch (e) {
      throw new Error('訂閱設定格式錯誤，請檢查 JSON 語法');
    }

    return decodedContent;
  } finally {
    clearTimeout(timeoutId);
  }
}

// 從配置文件補充管理員配置
export function refineConfig(adminConfig: AdminConfig): AdminConfig {
  let fileConfig: ConfigFileStruct;
  try {
    fileConfig = JSON.parse(adminConfig.ConfigFile) as ConfigFileStruct;
  } catch (e) {
    fileConfig = {} as ConfigFileStruct;
  }

  // 合併文件中的源資訊
  const apiSitesFromFile = Object.entries(fileConfig.api_site || []);
  const currentApiSites = new Map(
    (adminConfig.SourceConfig || []).map((s) => [s.key, s])
  );

  apiSitesFromFile.forEach(([key, site]) => {
    const existingSource = currentApiSites.get(key);
    if (existingSource) {
      // 如果已存在，只覆蓋 name、api、detail 和 from
      existingSource.name = toDisplayLanguage(site.name);
      existingSource.api = site.api;
      existingSource.detail = site.detail;
      existingSource.from = 'config';
    } else {
      // 如果不存在，創建新條目
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

  // 將 Map 轉換回數組
  adminConfig.SourceConfig = Array.from(currentApiSites.values());

  // 覆蓋 CustomCategories
  const customCategoriesFromFile = fileConfig.custom_category || [];
  const currentCustomCategories = new Map(
    (adminConfig.CustomCategories || []).map((c) => [c.query + c.type, c])
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

  // 檢查現有 CustomCategories 是否在 fileConfig.custom_category 中，如果不在則標記為 custom
  const customCategoriesFromFileKeys = new Set(
    customCategoriesFromFile.map((c) => c.query + c.type)
  );
  currentCustomCategories.forEach((category) => {
    if (!customCategoriesFromFileKeys.has(category.query + category.type)) {
      category.from = 'custom';
    }
  });

  // 將 Map 轉換回數組
  adminConfig.CustomCategories = Array.from(currentCustomCategories.values());

  const livesFromFile = Object.entries(fileConfig.lives || []);
  const currentLives = new Map(
    (adminConfig.LiveConfig || []).map((l) => [l.key, l])
  );
  livesFromFile.forEach(([key, site]) => {
    const existingLive = currentLives.get(key);
    if (existingLive) {
      existingLive.name = toDisplayLanguage(site.name);
      existingLive.url = site.url;
      existingLive.ua = site.ua;
      existingLive.epg = site.epg;
    } else {
      // 如果不存在，創建新條目
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

  // 檢查現有 LiveConfig 是否在 fileConfig.lives 中，如果不在則標記為 custom
  const livesFromFileKeys = new Set(livesFromFile.map(([key]) => key));
  currentLives.forEach((live) => {
    if (!livesFromFileKeys.has(live.key)) {
      live.from = 'custom';
    }
  });

  // 將 Map 轉換回數組
  adminConfig.LiveConfig = Array.from(currentLives.values());

  return adminConfig;
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
    cfgFile = JSON.parse(configFile) as ConfigFileStruct;
  } catch (e) {
    cfgFile = {} as ConfigFileStruct;
  }
  const adminConfig: AdminConfig = {
    ConfigFile: configFile,
    ConfigSubscription: subConfig,
    SiteConfig: {
      SiteName: process.env.NEXT_PUBLIC_SITE_NAME || 'BerserkerTV',
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
    console.error('獲取使用者列表失敗:', e);
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

  // 從配置文件中補充源資訊
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

  // 從配置文件中補充自定義分類資訊
  cfgFile.custom_category?.forEach((category) => {
    adminConfig.CustomCategories.push({
      name: category.name || category.query,
      type: category.type,
      query: category.query,
      from: 'config',
      disabled: false,
    });
  });

  // 從配置文件中補充直播源資訊
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

export async function getConfig(): Promise<AdminConfig> {
  // 使用內存緩存，帶 TTL 過期檢查
  if (cachedConfig && Date.now() - cachedConfigTimestamp < CONFIG_CACHE_TTL) {
    return cachedConfig;
  }

  // 讀 db
  let adminConfig: AdminConfig | null = null;
  try {
    adminConfig = await db.getAdminConfig();
  } catch (e) {
    console.error('獲取管理員配置失敗:', e);
  }

  // db 中無配置，執行一次初始化
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
  adminConfig = configSelfCheck(adminConfig);
  cachedConfig = adminConfig;
  cachedConfigTimestamp = Date.now();
  try {
    await db.saveAdminConfig(cachedConfig);
  } catch (error) {
    console.error('保存自我修復後的管理員配置失敗:', error);
  }
  return cachedConfig;
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
  if (!adminConfig.SiteConfig) {
    adminConfig.SiteConfig = {
      SiteName: 'BerserkerTV',
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
    };
  }
  if (
    !adminConfig.SiteConfig.SiteName ||
    adminConfig.SiteConfig.SiteName === 'MoonTV'
  ) {
    adminConfig.SiteConfig.SiteName = 'BerserkerTV';
  }

  if (!adminConfig.UserConfig) {
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

  const decodedContent = await fetchSubscriptionConfigFile(subscriptionUrl);
  const adminConfig = refineConfig({
    ...originConfig,
    ConfigFile: decodedContent,
    ConfigSubscription: {
      ...subscription,
      URL: subscriptionUrl,
      LastCheck: new Date().toISOString(),
    },
  });

  cachedConfig = adminConfig;
  cachedConfigTimestamp = Date.now();
  await db.saveAdminConfig(adminConfig);

  return;
}

export async function getCacheTime(): Promise<number> {
  const config = await getConfig();
  return config.SiteConfig.SiteInterfaceCacheTime || 7200;
}

function getServerStorageType():
  'localstorage' | 'redis' | 'upstash' | 'kvrocks' {
  return (
    ((process.env.STORAGE_TYPE || process.env.NEXT_PUBLIC_STORAGE_TYPE) as
      'localstorage' | 'redis' | 'upstash' | 'kvrocks' | undefined) ||
    'localstorage'
  );
}

export async function getValidUser(
  username?: string
): Promise<ConfigUser | null> {
  if (!username) {
    return null;
  }

  if (
    username === 'localstorage' &&
    getServerStorageType() === 'localstorage'
  ) {
    return {
      username,
      role: 'user',
      banned: false,
    };
  }

  const config = await getConfig();
  const userConfig = config.UserConfig.Users.find(
    (u) => u.username === username
  );
  if (!userConfig || userConfig.banned) {
    return null;
  }

  return userConfig;
}

export async function getAdminUser(
  username?: string
): Promise<ConfigUser | null> {
  const userConfig = await getValidUser(username);
  if (!userConfig || !['owner', 'admin'].includes(userConfig.role)) {
    return null;
  }

  return userConfig;
}

export async function getAvailableApiSites(user?: string): Promise<ApiSite[]> {
  const config = await getConfig();
  const allApiSites = config.SourceConfig.filter((s) => !s.disabled);

  if (!user) {
    return allApiSites;
  }

  if (user === 'localstorage') {
    return getServerStorageType() === 'localstorage' ? allApiSites : [];
  }

  const userConfig = config.UserConfig.Users.find((u) => u.username === user);
  if (!userConfig || userConfig.banned) {
    return [];
  }

  // 優先根據使用者自己的 enabledApis 配置查找
  if (userConfig.enabledApis && userConfig.enabledApis.length > 0) {
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

  // 如果沒有 enabledApis 配置，則根據 tags 查找
  if (userConfig.tags && userConfig.tags.length > 0 && config.UserConfig.Tags) {
    const enabledApisFromTags = new Set<string>();

    // 遍歷使用者的所有 tags，收集對應的 enabledApis
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

  // 如果都沒有配置，返回所有可用的 API 站點
  return allApiSites;
}

/** @fires-and-forget */
export async function setCachedConfig(config: AdminConfig) {
  cachedConfig = config;
  cachedConfigTimestamp = Date.now();
}
