import { filterAdsFromM3U8Detailed } from './hls-ad-filter';

describe('HLS ad filter', () => {
  it('removes segments between CUE-OUT and CUE-IN markers', () => {
    const result = filterAdsFromM3U8Detailed(
      [
        '#EXTM3U',
        '#EXTINF:6,',
        'main-1.ts',
        '#EXT-X-CUE-OUT:30',
        '#EXTINF:10,',
        'ad-1.ts',
        '#EXTINF:10,',
        'ad-2.ts',
        '#EXT-X-CUE-IN',
        '#EXTINF:6,',
        'main-2.ts',
      ].join('\n')
    );

    expect(result.removedSegments).toBe(2);
    expect(result.content).toContain('main-1.ts');
    expect(result.content).toContain('main-2.ts');
    expect(result.content).not.toContain('ad-1.ts');
    expect(result.content).not.toContain('ad-2.ts');
    expect(result.content).not.toContain('#EXT-X-CUE-OUT');
  });

  it('removes ad DATERANGE metadata without removing normal segments', () => {
    const result = filterAdsFromM3U8Detailed(
      [
        '#EXTM3U',
        '#EXT-X-DATERANGE:ID="ad-1",CLASS="com.apple.hls.interstitial",X-ASSET-URI="ad.m3u8"',
        '#EXTINF:6,',
        'main.ts',
      ].join('\n')
    );

    expect(result.removedSegments).toBe(0);
    expect(result.content).not.toContain('DATERANGE');
    expect(result.content).toContain('main.ts');
  });

  it('removes METHOD=NONE ad break only after encrypted content and discontinuity', () => {
    const result = filterAdsFromM3U8Detailed(
      [
        '#EXTM3U',
        '#EXT-X-KEY:METHOD=AES-128,URI="main.key"',
        '#EXTINF:6,',
        'main-1.ts',
        '#EXT-X-DISCONTINUITY',
        '#EXT-X-KEY:METHOD=NONE',
        '#EXTINF:15,',
        'ad-1.ts',
        '#EXT-X-DISCONTINUITY',
        '#EXT-X-KEY:METHOD=AES-128,URI="main.key"',
        '#EXTINF:6,',
        'main-2.ts',
      ].join('\n')
    );

    expect(result.removedSegments).toBe(1);
    expect(result.content).toContain('main-1.ts');
    expect(result.content).toContain('main-2.ts');
    expect(result.content).not.toContain('ad-1.ts');
    expect(result.content).not.toContain('#EXT-X-DISCONTINUITY');
  });

  it('removes discontinuity markers like the upstream player filter', () => {
    const result = filterAdsFromM3U8Detailed(
      [
        '#EXTM3U',
        '#EXTINF:6,',
        'main-1.ts',
        '#EXT-X-DISCONTINUITY',
        '#EXTINF:6,',
        'main-2.ts',
      ].join('\n')
    );

    expect(result.removedSegments).toBe(0);
    expect(result.content).not.toContain('#EXT-X-DISCONTINUITY');
    expect(result.content).toContain('main-1.ts');
    expect(result.content).toContain('main-2.ts');
  });

  it('stops filtering when CUE-OUT never receives CUE-IN', () => {
    const result = filterAdsFromM3U8Detailed(
      [
        '#EXTM3U',
        '#EXT-X-CUE-OUT:30',
        '#EXTINF:6,',
        'maybe-ad-1.ts',
        '#EXTINF:6,',
        'maybe-ad-2.ts',
        '#EXTINF:6,',
        'maybe-ad-3.ts',
        '#EXTINF:6,',
        'maybe-ad-4.ts',
        '#EXTINF:6,',
        'maybe-ad-5.ts',
        '#EXTINF:6,',
        'maybe-ad-6.ts',
        '#EXTINF:6,',
        'main-after-broken-cue-1.ts',
        '#EXTINF:6,',
        'main-after-broken-cue-2.ts',
      ].join('\n')
    );

    expect(result.removedSegments).toBe(6);
    expect(result.content).not.toContain('maybe-ad-1.ts');
    expect(result.content).not.toContain('maybe-ad-6.ts');
    expect(result.content).toContain('main-after-broken-cue-1.ts');
    expect(result.content).toContain('main-after-broken-cue-2.ts');
  });
});
