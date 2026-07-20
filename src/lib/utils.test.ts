import {
  cleanHtmlTags,
  formatYear,
  getBestM3u8VariantQuality,
  getProxiedImageUrl,
  getQualityFromWidth,
  processImageUrl,
} from './utils';

describe('formatYear', () => {
  // downstream 抓不到年份時會填字串 'unknown'，是內部哨兵值不該顯示給使用者
  it('把 unknown 哨兵值視為沒有年份', () => {
    expect(formatYear('unknown')).toBe('');
  });

  it('把舊紀錄殘留的 undefined / null 字串視為沒有年份', () => {
    expect(formatYear('undefined')).toBe('');
    expect(formatYear('null')).toBe('');
  });

  it('沒有值時回傳空字串', () => {
    expect(formatYear('')).toBe('');
    expect(formatYear(undefined)).toBe('');
    expect(formatYear('   ')).toBe('');
  });

  it('保留正常年份', () => {
    expect(formatYear('2026')).toBe('2026');
    expect(formatYear(' 2025 ')).toBe('2025');
  });
});

describe('utils m3u8 quality helpers', () => {
  it('maps video width to quality labels', () => {
    expect(getQualityFromWidth(3840)).toBe('4K');
    expect(getQualityFromWidth(2560)).toBe('2K');
    expect(getQualityFromWidth(1920)).toBe('1080p');
    expect(getQualityFromWidth(1280)).toBe('720p');
    expect(getQualityFromWidth(854)).toBe('480p');
    expect(getQualityFromWidth(640)).toBe('SD');
    expect(getQualityFromWidth(0)).toBe('');
  });

  it('uses the highest resolution variant from a master playlist', () => {
    const content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480
480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3600000,RESOLUTION=1920x1080
1080p.m3u8`;

    expect(getBestM3u8VariantQuality(content)).toBe('1080p');
  });

  it('uses bandwidth as tiebreaker when resolution is equal', () => {
    const content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720
high.m3u8`;

    expect(getBestM3u8VariantQuality(content)).toBe('720p');
  });
});

describe('processImageUrl', () => {
  it('returns empty string for falsy input', () => {
    expect(processImageUrl('')).toBe('');
  });

  it('returns local paths unchanged', () => {
    expect(processImageUrl('/images/poster.jpg')).toBe('/images/poster.jpg');
  });

  it('returns data URLs unchanged', () => {
    expect(processImageUrl('data:image/png;base64,abc')).toBe(
      'data:image/png;base64,abc'
    );
  });

  it('returns blob URLs unchanged', () => {
    expect(processImageUrl('blob:http://localhost/123')).toBe(
      'blob:http://localhost/123'
    );
  });

  it('returns non-doubanio https URLs unchanged for direct loading', () => {
    // 直連優先：伺服器代理僅作 onError 備援（VPS 出口 IP 常被中國圖床封鎖）
    expect(processImageUrl('https://example.com/image.jpg')).toBe(
      'https://example.com/image.jpg'
    );
  });

  it('keeps protocol-relative URLs direct and trims whitespace', () => {
    expect(processImageUrl(' //cdn.example.com/image.jpg ')).toBe(
      '//cdn.example.com/image.jpg'
    );
  });

  it('proxies plain http URLs to avoid mixed content blocking', () => {
    expect(processImageUrl('http://example.com/image.jpg')).toBe(
      `/api/image-proxy?url=${encodeURIComponent(
        'http://example.com/image.jpg'
      )}`
    );
  });
});

describe('getProxiedImageUrl', () => {
  it('builds an image-proxy URL', () => {
    expect(getProxiedImageUrl('https://example.com/a.jpg')).toBe(
      `/api/image-proxy?url=${encodeURIComponent('https://example.com/a.jpg')}`
    );
  });

  it('completes protocol-relative URLs with https', () => {
    expect(getProxiedImageUrl('//cdn.example.com/a.jpg')).toBe(
      `/api/image-proxy?url=${encodeURIComponent(
        'https://cdn.example.com/a.jpg'
      )}`
    );
  });
});

describe('cleanHtmlTags', () => {
  it('returns empty string for falsy input', () => {
    expect(cleanHtmlTags('')).toBe('');
  });

  it('strips simple HTML tags', () => {
    expect(cleanHtmlTags('<p>Hello</p>')).toBe('Hello');
  });

  it('strips nested HTML tags', () => {
    expect(cleanHtmlTags('<div><span>Nested</span></div>')).toBe('Nested');
  });

  it('decodes HTML entities', () => {
    expect(cleanHtmlTags('&amp; &lt; &gt;')).toBe('& < >');
  });

  it('collapses multiple newlines', () => {
    expect(cleanHtmlTags('<p>A</p><p>B</p><p>C</p>')).toBe('A\nB\nC');
  });

  it('trims whitespace', () => {
    expect(cleanHtmlTags('  <p>  Hello  </p>  ')).toBe('Hello');
  });
});
