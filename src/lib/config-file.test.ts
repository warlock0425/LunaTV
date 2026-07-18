/** @jest-environment node */

import { configSelfCheck, parseConfigFile } from './config';

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
