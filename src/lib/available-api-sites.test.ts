/**
 * P0：片源權限不得 fail-open。
 *
 * 病因：`enabledApis: []` 與「未設定」共用 `length > 0` 分支，
 * 刪源把最後一個 key 濾掉後變成空陣列，反而落到「全部片源」。
 *
 * 語意契約：
 * - undefined → 未設定 → tags → 全部
 * - []        → 明確零權限
 * - ['a']     → 白名單
 */

import type { AdminConfig } from './admin.types';
import { selectAvailableApiSites } from './config';

function site(
  key: string,
  opts?: { disabled?: boolean }
): AdminConfig['SourceConfig'][number] {
  return {
    key,
    name: key,
    api: `https://example.com/${key}`,
    from: 'custom',
    disabled: opts?.disabled,
  };
}

function config(partial: {
  sources: AdminConfig['SourceConfig'];
  users: AdminConfig['UserConfig']['Users'];
  tags?: AdminConfig['UserConfig']['Tags'];
}): AdminConfig {
  return {
    ConfigSubscription: { URL: '', AutoUpdate: false, LastCheck: '' },
    ConfigFile: '',
    SiteConfig: {
      SiteName: 't',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 7200,
      DoubanProxyType: '',
      DoubanProxy: '',
      DoubanImageProxyType: '',
      DoubanImageProxy: '',
      DisableYellowFilter: false,
      FluidSearch: false,
      EnableWebLive: false,
      PreferValidatedSourceOrder: false,
    },
    UserConfig: {
      Users: partial.users,
      Tags: partial.tags,
    },
    SourceConfig: partial.sources,
    CustomCategories: [],
    LiveConfig: [],
  };
}

describe('selectAvailableApiSites — enabledApis 語意', () => {
  const sources = [site('A'), site('B'), site('C')];

  it('只允許 A、無 tag → 刪 A（enabledApis 濾成 []）→ 可用片源為空（fail-closed）', () => {
    // 模擬 source/route delete：filter 掉 key 後留下空陣列，不是 delete 欄位
    const enabledApis = ['A'].filter((api) => api !== 'A');
    expect(enabledApis).toEqual([]);

    const result = selectAvailableApiSites(
      config({
        sources,
        users: [
          {
            username: 'alice',
            role: 'user',
            enabledApis,
          },
        ],
      }),
      'alice'
    );

    expect(result).toEqual([]);
  });

  it('enabledApis 未設定（undefined）→ 行為不變，回全部未停用源', () => {
    const result = selectAvailableApiSites(
      config({
        sources: [...sources, site('D', { disabled: true })],
        users: [
          {
            username: 'bob',
            role: 'user',
            // 未設定白名單
          },
        ],
      }),
      'bob'
    );

    expect(result.map((s) => s.key).sort()).toEqual(['A', 'B', 'C']);
  });

  it('白名單非空時只回允許的源', () => {
    const result = selectAvailableApiSites(
      config({
        sources,
        users: [
          {
            username: 'carol',
            role: 'user',
            enabledApis: ['A', 'C'],
          },
        ],
      }),
      'carol'
    );

    expect(result.map((s) => s.key).sort()).toEqual(['A', 'C']);
  });

  it('有空 enabledApis 時不得落到 tags 放行', () => {
    // 即使有有效 tag，已存在的空陣列仍是零權限（優先於 tags）
    const result = selectAvailableApiSites(
      config({
        sources,
        users: [
          {
            username: 'dave',
            role: 'user',
            enabledApis: [],
            tags: ['vip'],
          },
        ],
        tags: [{ name: 'vip', enabledApis: ['B'] }],
      }),
      'dave'
    );

    expect(result).toEqual([]);
  });

  it('未設定 enabledApis 但有 tags → 仍走 tag 白名單', () => {
    const result = selectAvailableApiSites(
      config({
        sources,
        users: [
          {
            username: 'erin',
            role: 'user',
            tags: ['vip'],
          },
        ],
        tags: [{ name: 'vip', enabledApis: ['B'] }],
      }),
      'erin'
    );

    expect(result.map((s) => s.key)).toEqual(['B']);
  });
});
