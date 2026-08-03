/** @jest-environment node */

import type { AdminConfig } from './admin.types';
import { configSelfCheck, parseConfigFile, refineConfig } from './config';

function baseAdminConfig(overrides: Partial<AdminConfig> = {}): AdminConfig {
  return {
    ConfigFile: '',
    ConfigSubscription: { URL: '', AutoUpdate: false, LastCheck: '' },
    SiteConfig: {
      SiteName: 'Test',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 7200,
      DoubanProxyType: 'direct',
      DoubanProxy: '',
      DoubanImageProxyType: 'direct',
      DoubanImageProxy: '',
      DisableYellowFilter: false,
      FluidSearch: true,
      EnableWebLive: false,
      PreferValidatedSourceOrder: false,
    },
    UserConfig: { Users: [] },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
    ...overrides,
  };
}

describe('parseConfigFile', () => {
  it('accepts a valid configuration file', () => {
    expect(
      parseConfigFile(
        JSON.stringify({
          cache_time: 60,
          api_site: {
            demo: { name: 'Demo', api: 'https://example.com/api.php' },
          },
          custom_category: [{ name: '動畫', type: 'tv', query: '動畫' }],
          lives: {
            news: { name: 'News', url: 'https://example.com/live.m3u' },
          },
        })
      )
    ).toMatchObject({ cache_time: 60 });
  });

  it.each([
    ['array root', '[]'],
    ['object instead of category array', '{"custom_category":{}}'],
    [
      'invalid category type',
      '{"custom_category":[{"type":"bad","query":"q"}]}',
    ],
    [
      'source key that breaks storage keys',
      '{"api_site":{"api+a":{"name":"A","api":"https://a.test"}}}',
    ],
  ])('rejects %s', (_name, value) => {
    expect(() => parseConfigFile(value)).toThrow();
  });

  it('repairs invalid persisted array entries before they reach request paths', () => {
    process.env.USERNAME = 'owner';
    const repaired = configSelfCheck({
      SiteConfig: { SearchDownstreamMaxPage: 999 },
      UserConfig: {
        Users: [
          {
            username: 'alice',
            role: 'user',
            enabledApis: 'not-an-array',
          },
          null,
        ],
        Tags: [{ name: 'group', enabledApis: 'bad' }],
      },
      SourceConfig: [null],
      CustomCategories: [{ type: 'bad', query: 'x' }],
      LiveConfig: [null],
    } as never);

    expect(repaired.SiteConfig.SearchDownstreamMaxPage).toBe(20);
    expect(repaired.UserConfig.Users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ username: 'owner', role: 'owner' }),
        expect.objectContaining({
          username: 'alice',
          enabledApis: undefined,
        }),
      ])
    );
    expect(repaired.UserConfig.Tags).toEqual([
      { name: 'group', enabledApis: [] },
    ]);
    expect(repaired.SourceConfig).toEqual([]);
    expect(repaired.CustomCategories).toEqual([]);
    expect(repaired.LiveConfig).toEqual([]);
  });
});

describe('refineConfig 安全契約', () => {
  it('ConfigFile 無法解析時拋錯，且不改動傳入物件的 from 標記', () => {
    const input = baseAdminConfig({
      ConfigFile: 'not-json{{{',
      SourceConfig: [
        {
          key: 'sub1',
          name: '訂閱源',
          api: 'https://a.test/api',
          from: 'config',
        },
      ],
    });
    const before = structuredClone(input);

    expect(() => refineConfig(input)).toThrow(/無法解析|中止合併/);
    // 失敗不得就地改寫呼叫端（尤其是 getConfig 快取本體）
    expect(input).toEqual(before);
    expect(input.SourceConfig[0].from).toBe('config');
  });

  it('合法合併時只覆蓋 name/api/detail，保留 disabled，並回傳新物件', () => {
    const input = baseAdminConfig({
      ConfigFile: JSON.stringify({
        api_site: {
          sub1: {
            name: '新名称',
            api: 'https://new.test/api.php',
            detail: 'https://new.test/detail',
          },
        },
      }),
      SourceConfig: [
        {
          key: 'sub1',
          name: '舊名',
          api: 'https://old.test/api.php',
          from: 'config',
          disabled: true,
        },
        {
          key: 'manual',
          name: '手加',
          api: 'https://manual.test/api.php',
          from: 'custom',
        },
      ],
    });

    const out = refineConfig(input);

    expect(out).not.toBe(input);
    expect(input.SourceConfig[0].name).toBe('舊名'); // 輸入未被就地改
    expect(out.SourceConfig.find((s) => s.key === 'sub1')).toMatchObject({
      // toDisplayLanguage 會轉繁，但 api/detail/disabled/from 契約才是重點
      api: 'https://new.test/api.php',
      detail: 'https://new.test/detail',
      from: 'config',
      disabled: true,
    });
    expect(out.SourceConfig.find((s) => s.key === 'manual')?.from).toBe(
      'custom'
    );
  });

  it('空的合法設定檔（無 api_site）才會把既有源標成 custom（刻意行為）', () => {
    const out = refineConfig(
      baseAdminConfig({
        ConfigFile: JSON.stringify({}),
        SourceConfig: [
          {
            key: 'sub1',
            name: '訂閱源',
            api: 'https://a.test/api',
            from: 'config',
          },
        ],
      })
    );
    expect(out.SourceConfig[0].from).toBe('custom');
  });
});
