import { getConfig, getFreshConfig } from './config';
import { db } from './db';
import {
  getCachedLiveChannels,
  isWebLiveEnabled,
  refreshLiveChannels,
} from './live';
import { fetchSafeRemoteUrl, readResponseTextWithLimit } from './url-safety';

jest.mock('./config', () => ({
  getConfig: jest.fn(),
  getFreshConfig: jest.fn(),
  setCachedConfig: jest.fn(),
}));
jest.mock('./db', () => ({
  db: {
    saveAdminConfig: jest.fn(),
    withAdminConfigLock: jest.fn(async (fn: () => Promise<unknown>) => fn()),
  },
}));
jest.mock('./url-safety', () => ({
  fetchSafeRemoteUrl: jest.fn(),
  readResponseTextWithLimit: jest.fn(),
}));

const mockedGetConfig = jest.mocked(getConfig);
const mockedGetFreshConfig = jest.mocked(getFreshConfig);
const mockedSaveAdminConfig = jest.mocked(db.saveAdminConfig);
const mockedFetch = jest.mocked(fetchSafeRemoteUrl);
const mockedReadText = jest.mocked(readResponseTextWithLimit);

describe('isWebLiveEnabled', () => {
  it('only treats an explicit true flag as enabled', () => {
    expect(isWebLiveEnabled(undefined)).toBe(false);
    expect(isWebLiveEnabled({ SiteConfig: {} })).toBe(false);
    expect(isWebLiveEnabled({ SiteConfig: { EnableWebLive: false } })).toBe(
      false
    );
    expect(isWebLiveEnabled({ SiteConfig: { EnableWebLive: true } })).toBe(
      true
    );
  });
});

describe('live channel cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not load or refresh a disabled source', async () => {
    const liveInfo = {
      key: 'disabled-live',
      name: 'Disabled',
      url: 'https://example.test/live.m3u',
      from: 'custom' as const,
      disabled: true,
    };
    mockedGetConfig.mockResolvedValue({
      LiveConfig: [liveInfo],
    } as Awaited<ReturnType<typeof getConfig>>);

    await expect(getCachedLiveChannels(liveInfo.key)).resolves.toBeNull();
    await expect(refreshLiveChannels(liveInfo)).resolves.toBe(0);
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(mockedSaveAdminConfig).not.toHaveBeenCalled();
  });

  it('drops an existing cache entry after its source becomes disabled', async () => {
    const liveInfo = {
      key: 'toggle-live',
      name: 'Toggle',
      url: 'https://example.test/live.m3u',
      from: 'custom' as const,
      disabled: false,
    };
    const config = { LiveConfig: [liveInfo] } as Awaited<
      ReturnType<typeof getConfig>
    >;
    mockedGetConfig.mockResolvedValue(config);
    mockedGetFreshConfig.mockResolvedValue(config);
    mockedFetch.mockResolvedValue({} as Response);
    mockedReadText.mockResolvedValue(
      '#EXTM3U\n#EXTINF:-1 tvg-id="one",One\nhttps://cdn.example/one.m3u8'
    );

    const active = await getCachedLiveChannels(liveInfo.key);
    expect(active?.channels).toHaveLength(1);

    liveInfo.disabled = true;
    await expect(getCachedLiveChannels(liveInfo.key)).resolves.toBeNull();
  });
});
