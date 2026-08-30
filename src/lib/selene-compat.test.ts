import { toSeleneLiveSource, toSeleneSearchResource } from './selene-compat';

describe('toSeleneSearchResource', () => {
  it('fills Selene local-search fields without leaking extra keys', () => {
    expect(
      toSeleneSearchResource({
        key: 'dytt',
        name: '電影天堂',
        api: 'https://example.test/api.php/provide/vod',
      })
    ).toEqual({
      key: 'dytt',
      name: '電影天堂',
      api: 'https://example.test/api.php/provide/vod',
      detail: '',
      from: 'config',
      disabled: false,
    });
  });

  it('keeps optional detail URLs', () => {
    expect(
      toSeleneSearchResource({
        key: 'src',
        name: '源',
        api: 'https://a.test/api',
        detail: 'https://a.test',
      }).detail
    ).toBe('https://a.test');
  });
});

describe('toSeleneLiveSource', () => {
  it('normalizes missing ua/epg so Dart String fields do not see null', () => {
    expect(
      toSeleneLiveSource({
        key: 'cctv',
        name: '央視',
        url: 'https://live.example.test/tv.m3u',
        from: 'custom',
      })
    ).toEqual({
      key: 'cctv',
      name: '央視',
      url: 'https://live.example.test/tv.m3u',
      ua: '',
      epg: '',
      from: 'custom',
      disabled: false,
    });
  });
});
